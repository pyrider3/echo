#!/usr/bin/env bash
set -e
cd /mnt/c/Users/p/Documents/Codex/2026-07-30/b/bridge
exec /home/pr/WeClone/.venv/bin/uvicorn voice_server:app --host 127.0.0.1 --port 8007 \
  > /mnt/c/Users/p/Documents/Codex/2026-07-30/b/work/voice.out.log \
  2> /mnt/c/Users/p/Documents/Codex/2026-07-30/b/work/voice.err.log
