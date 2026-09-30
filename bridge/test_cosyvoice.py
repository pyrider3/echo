import sys
import time
from pathlib import Path

import soundfile as sf
import torch

COSY_ROOT = Path("/home/pr/CosyVoice")
sys.path[:0] = [
    str(Path(__file__).parent / "cosyvoice_compat"),
    str(COSY_ROOT),
    str(COSY_ROOT / "third_party/Matcha-TTS"),
]

from cosyvoice.cli.cosyvoice import AutoModel

model_path = COSY_ROOT / "pretrained_models/Fun-CosyVoice3-0.5B"
reference = COSY_ROOT / "asset/zero_shot_prompt.wav"
output = Path(__file__).parent.parent / "output/echo-cosyvoice-test.wav"
output.parent.mkdir(parents=True, exist_ok=True)

load_started = time.perf_counter()
model = AutoModel(model_dir=str(model_path), fp16=True)
load_seconds = time.perf_counter() - load_started

started = time.perf_counter()
chunks = []
first_audio_seconds = None
text = "You are a helpful assistant.<|endofprompt|>你好，我一直都在这里，今天过得怎么样？"
for result in model.inference_cross_lingual(text, str(reference), stream=True):
    if first_audio_seconds is None:
        first_audio_seconds = time.perf_counter() - started
    chunks.append(result["tts_speech"].cpu())

audio = torch.cat(chunks, dim=1).detach().float().squeeze(0).numpy()
sf.write(output, audio, model.sample_rate)
print({
    "load_seconds": round(load_seconds, 3),
    "first_audio_seconds": round(first_audio_seconds or 0, 3),
    "total_seconds": round(time.perf_counter() - started, 3),
    "audio_seconds": round(len(audio) / model.sample_rate, 3),
    "chunks": len(chunks),
    "output": str(output),
})
