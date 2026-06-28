#!/usr/bin/env bash

# ideall 本地开发启动脚本（Next.js dev, 端口 5020）。
#
# 用法：
#   bash scripts/run.sh          # 启动 ideall
#   pnpm dev                     # 等价命令

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"

if [[ ! -d "node_modules" ]]; then
  echo "Tip: run 'pnpm install' in ${ROOT_DIR} first." >&2
fi

echo "Starting ideall at http://localhost:5020 ..."
pnpm dev
