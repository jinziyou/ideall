#!/usr/bin/env bash
# 写入 wonita 真实 IP 到 /etc/hosts (Clash TUN fake-ip 兜底)。sudo 下无 pnpm → 用 node。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
exec sudo "$NODE" "$ROOT/scripts/wsl-wonita-hosts.mjs" --apply
