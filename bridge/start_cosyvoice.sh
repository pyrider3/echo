#!/usr/bin/env bash
set -e
cd "$(dirname "$(readlink -f "$0")")"
mkdir -p ../work
export PYTHONPATH="$PWD/cosyvoice_compat:/home/pr/CosyVoice:/home/pr/CosyVoice/third_party/Matcha-TTS"
# vLLM cuts the measured first audible chunk to roughly one second on the RTX
# 5080.  Set ECHO_COSYVOICE_VLLM=0 before launching for the safe PyTorch
# fallback; Spark-TTS on port 8007 is never replaced by this trial service.
export ECHO_COSYVOICE_VLLM="${ECHO_COSYVOICE_VLLM:-1}"
# Independent trial port: never replace Spark-TTS on 8007.
exec /home/pr/CosyVoice/.venv/bin/python -m uvicorn cosyvoice_server:app --host 127.0.0.1 --port 8009 \
  > ../work/cosyvoice.out.log \
  2> ../work/cosyvoice.err.log
