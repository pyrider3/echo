#!/usr/bin/env bash
set -e
cd /mnt/c/Users/p/Documents/Codex/2026-07-30/b/bridge
while true; do
  /home/pr/WeClone/.venv/bin/uvicorn pro_server:app --host 127.0.0.1 --port 8008 \
    >> /mnt/c/Users/p/Documents/Codex/2026-07-30/b/work/pro.out.log \
    2>> /mnt/c/Users/p/Documents/Codex/2026-07-30/b/work/pro.err.log
  exit_code=$?
  if [ "$exit_code" -ne 75 ]; then
    exit "$exit_code"
  fi
  sleep 1
done
