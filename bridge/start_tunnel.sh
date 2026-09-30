#!/usr/bin/env bash
set -e
WINDOWS_HOST=$(ip route show default | awk '{print $3}')
# QUIC repeatedly interrupted reference uploads on this network. Keep a
# protocol override available for networks with different routing.
exec cloudflared tunnel --no-autoupdate --protocol "${ECHO_TUNNEL_PROTOCOL:-http2}" --url "http://${WINDOWS_HOST}:8006" --logfile /mnt/c/Users/p/Documents/Codex/2026-07-30/b/work/tunnel.log --loglevel info run 0986f366-c473-490a-8113-383412067c9f
