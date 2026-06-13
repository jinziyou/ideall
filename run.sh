#!/usr/bin/env bash

# myos 本地开发启动脚本（Next.js dev, 端口 3000）。
#
# 用法：
#   bash run.sh                # 启动 myos

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "${SCRIPT_DIR}"

if [[ ! -d "node_modules" ]]; then
  echo "Tip: run 'pnpm install' in ${SCRIPT_DIR} first." >&2
fi

echo "Starting myos at http://localhost:3000 ..."
pnpm dev
