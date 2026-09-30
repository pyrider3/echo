import base64
import hashlib
import io
import os
import re
import struct
import subprocess
import sys
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

BRIDGE_ROOT = Path(__file__).parent
COSY_ROOT = Path("/home/pr/CosyVoice")
sys.path[:0] = [
    str(BRIDGE_ROOT / "cosyvoice_compat"),
    str(COSY_ROOT),
    str(COSY_ROOT / "third_party/Matcha-TTS"),
]

from cosyvoice.cli.cosyvoice import AutoModel

MODEL_DIR = COSY_ROOT / "pretrained_models/Fun-CosyVoice3-0.5B"
VOICES = Path("/home/pr/.echo/voices")
CACHE = Path("/home/pr/.echo/cosyvoice-cache")
VOICES.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

app = FastAPI()
model = None
model_error = None
model_lock = threading.Lock()
inference_lock = threading.Lock()
model_loading = False
model_ready = threading.Event()
USE_VLLM = os.getenv("ECHO_COSYVOICE_VLLM", "0") == "1"


class Reference(BaseModel):
    voiceId: str
    audio: str
    mime: str = "audio/wav"
    name: str = "sample"


class Synthesize(BaseModel):
    voiceId: str
    text: str


class Warm(BaseModel):
    voiceId: str


def safe_id(value):
    return re.sub(r"[^a-zA-Z0-9_-]", "", value)[:64]


def reference_path(voice_id):
    return VOICES / f"{safe_id(voice_id)}.wav"


def install_reference_cache(instance):
    frontend = instance.frontend
    for method_name in ("_extract_speech_token", "_extract_spk_embedding", "_extract_speech_feat"):
        original = getattr(frontend, method_name)
        values = OrderedDict()

        def cached(path, _original=original, _values=values):
            source = Path(path)
            key = (str(source), source.stat().st_mtime_ns)
            if key not in _values:
                _values[key] = _original(path)
                while len(_values) > 32:
                    _values.popitem(last=False)
            else:
                _values.move_to_end(key)
            return _values[key]

        setattr(frontend, method_name, cached)


def get_model():
    global model, model_error, model_loading
    if model is None:
        with model_lock:
            if model is None:
                try:
                    model_loading = True
                    torch.set_float32_matmul_precision("high")
                    instance = AutoModel(model_dir=str(MODEL_DIR), fp16=True, load_vllm=USE_VLLM)
                    install_reference_cache(instance)
                    model = instance
                    model_error = None
                except Exception as exc:
                    model_error = str(exc)
                    raise
                finally:
                    model_loading = False
    return model


def normalized_text(text):
    clean = str(text).strip()[:500]
    if not clean:
        raise HTTPException(400, "text required")
    return f"You are a helpful assistant. 请用自然、亲近、有交流感的语气表达，不要像播报。<|endofprompt|>{clean}"


def speech_chunks(payload):
    ref = reference_path(payload.voiceId)
    if not ref.exists():
        raise HTTPException(404, "voice reference missing")
    text = normalized_text(payload.text)
    if not model_ready.wait(timeout=180):
        raise HTTPException(503, "voice model is still warming")
    with inference_lock, torch.inference_mode():
        for result in get_model().inference_cross_lingual(text, str(ref), stream=True):
            yield result["tts_speech"].detach().float().cpu().squeeze().numpy()


@app.on_event("startup")
def preload_model():
    def initialize():
        global model_loading, model_error
        try:
            model_loading = True
            instance = get_model()
            model_loading = True
            sample = COSY_ROOT / "asset/zero_shot_prompt.wav"
            if sample.is_file():
                with inference_lock, torch.inference_mode():
                    instance.frontend._extract_speech_token(str(sample))
                    instance.frontend._extract_spk_embedding(str(sample))
                    instance.frontend._extract_speech_feat(str(sample))
                    for _ in instance.inference_cross_lingual(
                        normalized_text("我在。"), str(sample), stream=True, text_frontend=False
                    ):
                        pass
            model_ready.set()
        except Exception as exc:
            model_error = str(exc)
        finally:
            model_loading = False
    threading.Thread(target=initialize, daemon=True).start()


@app.get("/health")
def health():
    return {
        "ok": model_ready.is_set() and model_error is None,
        "engine": "Fun-CosyVoice3-0.5B",
        "modelLoaded": model is not None,
        "modelLoading": model_loading,
        "optimizedBackend": "vllm" if USE_VLLM else "pytorch",
        "cuda": torch.cuda.is_available(),
        "error": model_error,
    }


@app.post("/reference")
def reference(payload: Reference):
    voice_id = safe_id(payload.voiceId)
    if not voice_id:
        raise HTTPException(400, "invalid voice id")
    try:
        raw = base64.b64decode(payload.audio, validate=True)
    except Exception:
        raise HTTPException(400, "invalid audio")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(413, "audio too large")
    suffix = Path(payload.name).suffix or ".audio"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        handle.write(raw)
        source = handle.name
    target = reference_path(voice_id)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", source, "-t", "30", "-ac", "1", "-ar", "16000", str(target)],
            check=True,
            capture_output=True,
        )
    except Exception as exc:
        raise HTTPException(400, f"audio conversion failed: {exc}")
    finally:
        os.unlink(source)
    # Perform the expensive voice analysis while the wizard already shows
    # “processing”, so the first chat reply can start immediately.
    instance = get_model()
    with inference_lock, torch.inference_mode():
        instance.frontend._extract_speech_token(str(target))
        instance.frontend._extract_spk_embedding(str(target))
        instance.frontend._extract_speech_feat(str(target))
    return {"ok": True, "voiceId": voice_id}


@app.post("/synthesize")
def synthesize(payload: Synthesize):
    text = str(payload.text).strip()[:500]
    ref = reference_path(payload.voiceId)
    if not ref.is_file():
        raise HTTPException(404, "voice reference missing")
    normalized_text(text)
    key = hashlib.sha256(f"cosy3\0{payload.voiceId}\0{ref.stat().st_mtime_ns}\0{text}".encode()).hexdigest()
    cached = CACHE / f"{key}.wav"
    if cached.exists():
        return {"audio": base64.b64encode(cached.read_bytes()).decode("ascii"), "cached": True}
    chunks = list(speech_chunks(payload))
    if not chunks:
        raise HTTPException(500, "no audio generated")
    audio = np.concatenate(chunks)
    buffer = io.BytesIO()
    sf.write(buffer, audio, get_model().sample_rate, format="WAV", subtype="PCM_16")
    data = buffer.getvalue()
    cached.write_bytes(data)
    return {"audio": base64.b64encode(data).decode("ascii"), "cached": False}


@app.post("/stream")
def stream(payload: Synthesize):
    # Validate before sending HTTP 200, so clients can handle failures.
    if not reference_path(payload.voiceId).is_file():
        raise HTTPException(404, "voice reference missing")
    normalized_text(payload.text)
    sample_rate = get_model().sample_rate

    def generate():
        # Eight-byte header: ASCII ECHO + little-endian sample rate.
        yield b"ECHO" + struct.pack("<I", sample_rate)
        for chunk in speech_chunks(payload):
            pcm = np.clip(chunk, -1.0, 1.0)
            yield (pcm * 32767.0).astype("<i2").tobytes()

    return StreamingResponse(generate(), media_type="application/octet-stream", headers={"X-Echo-Audio": "pcm16le"})


@app.post("/warm")
def warm(payload: Warm):
    target = reference_path(payload.voiceId)
    if not target.is_file():
        raise HTTPException(404, "voice reference missing")
    with inference_lock, torch.inference_mode():
        instance = get_model()
        instance.frontend._extract_speech_token(str(target))
        instance.frontend._extract_spk_embedding(str(target))
        instance.frontend._extract_speech_feat(str(target))
    return {"ok": True, "voiceId": safe_id(payload.voiceId)}
