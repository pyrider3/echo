import json
import gc
import os
import re
import signal
import subprocess
import threading
import time
from pathlib import Path

import requests
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


WECLONE_ROOT = Path("/home/pr/WeClone")
PYTHON = WECLONE_ROOT / ".venv/bin/python"
CLI = WECLONE_ROOT / ".venv/bin/weclone-cli"
TRAIN_SCRIPT = Path(__file__).with_name("train_agent.py")
BASE_MODEL = WECLONE_ROOT / "models/Qwen2.5-7B-Instruct"
AGENTS_ROOT = Path("/home/pr/.echo/pro-agents")
INFERENCE_IDLE_SECONDS = max(60, int(os.environ.get("ECHO_INFERENCE_IDLE_SECONDS", "300")))
AGENTS_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI()
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()
queue_lock = threading.Lock()
queue_condition = threading.Condition(queue_lock)
pending_jobs: list[tuple[str, Path]] = []
current_training: str | None = None
inference_model = None
inference_tokenizer = None
active_agent: str | None = None
last_inference_activity = 0.0
inference_lock = threading.RLock()


class TrainRequest(BaseModel):
    agentId: str
    name: str
    relation: str = ""
    chatLog: str


class ChatRequest(BaseModel):
    agentId: str
    messages: list[dict]
    temperature: float = 0.72
    max_tokens: int = 140


def safe_id(value: str) -> str:
    result = re.sub(r"[^a-zA-Z0-9_-]", "", str(value))[:64]
    if not result:
        raise HTTPException(400, "invalid agent id")
    return result


def agent_dir(agent_id: str) -> Path:
    return AGENTS_ROOT / safe_id(agent_id)


def parse_chat(log: str, target_name: str) -> list[dict]:
    rows: list[tuple[str, str]] = []
    for raw in str(log).splitlines():
        match = re.match(r"^\s*([^:：\n]{1,24})\s*[:：]\s*(.+?)\s*$", raw)
        if match:
            rows.append((match.group(1).strip(), match.group(2).strip()))
    if len(rows) < 16:
        raise ValueError("聊天记录格式不足：请使用“姓名：内容”，至少包含 16 条消息")

    labels: dict[str, int] = {}
    for label, _ in rows:
        labels[label] = labels.get(label, 0) + 1
    normalized_target = re.sub(r"\s+", "", target_name).lower()
    target = next((label for label in labels if re.sub(r"\s+", "", label).lower() == normalized_target), None)
    if target is None:
        candidates = [(count, label) for label, count in labels.items() if label.lower() not in {"我", "本人", "自己", "me"}]
        target = max(candidates, default=(0, ""))[1]
    if not target:
        raise ValueError("无法识别要训练的人，请确认称呼与聊天记录中的姓名一致")

    grouped: list[dict] = []
    for label, content in rows:
        role = "assistant" if label == target else "user"
        if grouped and grouped[-1]["role"] == role:
            grouped[-1]["content"] += "\n" + content
        else:
            grouped.append({"role": role, "content": content})
    while grouped and grouped[0]["role"] != "user":
        grouped.pop(0)
    while grouped and grouped[-1]["role"] != "assistant":
        grouped.pop()

    system = f"你是{target_name}的 AI 模拟智能体。学习其表达风格，但必须明确自己是 AI 模拟，不能冒充真人。"
    examples = []
    for index in range(len(grouped) - 1):
        if grouped[index]["role"] == "user" and grouped[index + 1]["role"] == "assistant":
            start = max(0, index - 4)
            context = grouped[start : index + 2]
            if context[0]["role"] == "assistant":
                context = context[1:]
            examples.append({"messages": context, "system": system})
    if len(examples) < 8:
        raise ValueError("有效对话轮次不足：至少需要 8 轮双方对话")
    return examples


def make_config(target: Path, name: str, relation: str) -> dict:
    dataset_dir = target / "dataset"
    adapter_dir = target / "adapter"
    return {
        "version": "0.3.03",
        "common_args": {
            "model_name_or_path": str(BASE_MODEL),
            "adapter_name_or_path": str(adapter_dir),
            "template": "qwen",
            "default_system": f"你是{name}的 AI 模拟智能体，关系是{relation or '熟悉的人'}。不要冒充真人。",
            "media_dir": str(dataset_dir / "media"),
            "finetuning_type": "lora",
            "enable_thinking": False,
            "trust_remote_code": True,
        },
        "cli_args": {"full_log": True, "log_level": "INFO"},
        "make_dataset_args": {
            "platform": "chat", "language": "zh", "include_type": ["text"],
            "blocked_words": [], "add_time": False, "add_relation": False,
            "single_combine_strategy": "time_window", "qa_match_strategy": "time_window",
            "single_combine_time_window": 2, "qa_match_time_window": 5,
            "combine_msg_max_length": 1024, "messages_max_length": 1024,
            "clean_dataset": {"enable_clean": False}, "online_llm_clear": False,
            "clean_batch_size": 20, "vision_api": {"enable": False},
        },
        "train_sft_args": {
            "stage": "sft", "dataset": "chat-sft", "dataset_dir": str(dataset_dir),
            "use_fast_tokenizer": True, "lora_target": "q_proj,v_proj",
            "lora_rank": 8, "lora_dropout": 0.15, "weight_decay": 0.05,
            "overwrite_cache": True, "per_device_train_batch_size": 1,
            "gradient_accumulation_steps": 16, "lr_scheduler_type": "cosine",
            "cutoff_len": 1024, "logging_steps": 2, "save_steps": 100,
            "learning_rate": 0.0001, "warmup_ratio": 0.1, "num_train_epochs": 2,
            "plot_loss": True, "fp16": False, "bf16": True, "flash_attn": "auto",
            "quantization_bit": 4, "quantization_method": "bitsandbytes",
            "preprocessing_num_workers": 4, "dataloader_num_workers": 2,
        },
        "infer_args": {"repetition_penalty": 1.15, "temperature": 0.65, "max_length": 256, "top_p": 0.75},
        "vllm_args": {"gpu_memory_utilization": 0.82, "quantization": "bitsandbytes", "load_format": "bitsandbytes"},
        "test_model_args": {"test_data_path": "dataset/eval/test_data-zh.json"},
    }


def write_training_files(target: Path, request: TrainRequest) -> int:
    examples = parse_chat(request.chatLog, request.name)
    dataset_dir = target / "dataset"
    dataset_dir.mkdir(parents=True, exist_ok=True)
    (dataset_dir / "sft-my.json").write_text(json.dumps(examples, ensure_ascii=False, indent=2), encoding="utf-8")
    info = {"chat-sft": {"file_name": "./sft-my.json", "formatting": "sharegpt", "columns": {"messages": "messages", "system": "system"}, "tags": {"role_tag": "role", "content_tag": "content", "user_tag": "user", "assistant_tag": "assistant"}}}
    (dataset_dir / "dataset_info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    config = make_config(target, request.name, request.relation)
    (target / "settings.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    (target / "meta.json").write_text(json.dumps({"id": request.agentId, "name": request.name, "relation": request.relation, "examples": len(examples)}, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(examples)


def update_job(agent_id: str, **values):
    with jobs_lock:
        jobs.setdefault(agent_id, {}).update(values)


def queue_details(agent_id: str) -> tuple[int | None, int]:
    with queue_lock:
        for index, (queued_id, _) in enumerate(pending_jobs):
            if queued_id == agent_id:
                ahead = index + (1 if current_training else 0)
                return ahead + 1, ahead
    return None, 0


def training_dispatcher():
    global current_training
    while True:
        with queue_condition:
            while not pending_jobs:
                queue_condition.wait()
            agent_id, target = pending_jobs.pop(0)
            current_training = agent_id
        log_path = target / "train.log"
        update_job(agent_id, status="training", phase="正在训练表达风格", startedAt=time.time())
        try:
            with inference_lock:
                stop_inference()
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            env["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
            command = [str(PYTHON), str(TRAIN_SCRIPT), str(target / "settings.json")]
            with log_path.open("w", encoding="utf-8") as log:
                process = subprocess.run(command, cwd=WECLONE_ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            if process.returncode == 0 and (target / "adapter/adapter_config.json").exists():
                update_job(agent_id, status="ready", phase="训练完成", finishedAt=time.time())
            else:
                tail = log_path.read_text(encoding="utf-8", errors="replace")[-1200:] if log_path.exists() else ""
                update_job(agent_id, status="failed", phase="训练失败", error=tail, finishedAt=time.time())
        except Exception as error:
            update_job(agent_id, status="failed", phase="训练失败", error=str(error), finishedAt=time.time())
        finally:
            with queue_lock:
                current_training = None


def stop_inference():
    global inference_model, inference_tokenizer, active_agent, last_inference_activity
    inference_model = None
    inference_tokenizer = None
    active_agent = None
    last_inference_activity = 0.0
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def ensure_inference(agent_id: str):
    global inference_model, inference_tokenizer, active_agent, last_inference_activity
    target = agent_dir(agent_id)
    if not (target / "adapter/adapter_config.json").exists():
        raise HTTPException(409, "agent is not trained")
    if active_agent == agent_id and inference_model is not None:
        last_inference_activity = time.monotonic()
        return
    with inference_lock:
        if active_agent == agent_id and inference_model is not None:
            return
        stop_inference()
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

        quantization = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
        inference_tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
        base = AutoModelForCausalLM.from_pretrained(BASE_MODEL, device_map="auto", torch_dtype=torch.bfloat16, quantization_config=quantization, trust_remote_code=True)
        inference_model = PeftModel.from_pretrained(base, target / "adapter")
        inference_model.eval()
        active_agent = agent_id
        last_inference_activity = time.monotonic()


def inference_idle_watchdog():
    while True:
        time.sleep(15)
        with inference_lock:
            idle_for = time.monotonic() - last_inference_activity if last_inference_activity else 0
            if inference_model is not None and idle_for >= INFERENCE_IDLE_SECONDS:
                stop_inference()
                # CUDA/PEFT can retain allocator and compiler state after every
                # Python reference is released. Exit with a dedicated code so
                # start_pro.sh replaces this worker with a clean process.
                os._exit(75)


@app.get("/health")
def health():
    with queue_lock:
        queue_length = len(pending_jobs)
        training = current_training is not None
    idle_for = time.monotonic() - last_inference_activity if active_agent and last_inference_activity else 0
    unload_in = max(0, round(INFERENCE_IDLE_SECONDS - idle_for)) if active_agent else None
    return {"ok": True, "baseModelReady": BASE_MODEL.exists(), "activeAgent": active_agent, "training": training, "trainingAgent": current_training, "queueLength": queue_length, "inferenceIdleTimeout": INFERENCE_IDLE_SECONDS, "inferenceUnloadIn": unload_in}


@app.post("/train")
def train(request: TrainRequest):
    agent_id = safe_id(request.agentId)
    if not BASE_MODEL.exists():
        raise HTTPException(409, "base model is not downloaded")
    with jobs_lock:
        existing = dict(jobs.get(agent_id, {}))
    if existing.get("status") in {"queued", "training"}:
        position, ahead = queue_details(agent_id)
        return {"ok": True, "agentId": agent_id, **existing, "queuePosition": position, "aheadCount": ahead}
    target = agent_dir(agent_id)
    target.mkdir(parents=True, exist_ok=True)
    try:
        examples = write_training_files(target, request)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    with queue_condition:
        ahead = len(pending_jobs) + (1 if current_training else 0)
        phase = "即将开始训练" if ahead == 0 else f"排队等待训练 · 前面还有 {ahead} 个"
        update_job(agent_id, status="queued", phase=phase, examples=examples, error="", queuedAt=time.time())
        pending_jobs.append((agent_id, target))
        queue_condition.notify()
    return {"ok": True, "agentId": agent_id, "status": "queued", "phase": phase, "examples": examples, "queuePosition": ahead + 1, "aheadCount": ahead}


@app.get("/train/{agent_id}")
def train_status(agent_id: str):
    agent_id = safe_id(agent_id)
    target = agent_dir(agent_id)
    state = dict(jobs.get(agent_id, {}))
    if state.get("status") == "queued":
        position, ahead = queue_details(agent_id)
        state.update(queuePosition=position, aheadCount=ahead, phase="即将开始训练" if ahead == 0 else f"排队等待训练 · 前面还有 {ahead} 个")
    if not state and (target / "adapter/adapter_config.json").exists():
        state = {"status": "ready", "phase": "训练完成"}
    if not state:
        raise HTTPException(404, "training task not found")
    return {"agentId": agent_id, **state}


@app.post("/chat")
def chat(request: ChatRequest):
    global last_inference_activity
    agent_id = safe_id(request.agentId)
    with inference_lock, torch.inference_mode():
        ensure_inference(agent_id)
        last_inference_activity = time.monotonic()
        prompt = inference_tokenizer.apply_chat_template(request.messages, tokenize=False, add_generation_prompt=True)
        inputs = inference_tokenizer(prompt, return_tensors="pt").to(inference_model.device)
        output = inference_model.generate(**inputs, max_new_tokens=request.max_tokens, do_sample=True, temperature=max(0.1, request.temperature), top_p=0.75, repetition_penalty=1.15, pad_token_id=inference_tokenizer.eos_token_id)
        generated = output[0, inputs.input_ids.shape[1]:]
        content = inference_tokenizer.decode(generated, skip_special_tokens=True).strip()
        last_inference_activity = time.monotonic()
    return {"choices": [{"message": {"role": "assistant", "content": content}}]}


@app.on_event("shutdown")
def shutdown():
    stop_inference()


@app.on_event("startup")
def startup():
    threading.Thread(target=training_dispatcher, name="echo-training-queue", daemon=True).start()
    threading.Thread(target=inference_idle_watchdog, name="echo-inference-idle", daemon=True).start()
