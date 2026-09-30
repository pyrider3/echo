#!/usr/bin/env bash
set -e
cd /home/pr/WeClone
exec /home/pr/WeClone/.venv/bin/weclone-cli server \
  > /mnt/c/Users/p/Documents/Codex/2026-07-30/b/work/weclone-api.out.log \
  2> /mnt/c/Users/p/Documents/Codex/2026-07-30/b/work/weclone-api.err.log
