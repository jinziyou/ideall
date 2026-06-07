/**
 * 把 super/server/openapi.json 同步到 peer/openapi/server.json。
 *
 * 优先用 monorepo 内本地路径:
 *
 *     wonita/
 *       ├── peer/                ← working dir
 *       └── super/server/openapi.json     ← 期望的本地源
 *
 * 找不到本地副本时退化到 GitHub raw URL (需联网)。
 *
 * 用法:
 *
 *     pnpm sync:api                      # 默认 main 分支
 *     SERVER_REF=feat-x pnpm sync:api    # 指定分支/tag/commit
 *     SERVER_LOCAL=/abs/path.json pnpm sync:api   # 强制使用本地路径
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const APP_ROOT = resolve(__dirname, "..")
const OUTPUT = resolve(APP_ROOT, "openapi/server.json")
const DEFAULT_LOCAL = resolve(APP_ROOT, "../super/server/openapi.json")
const REPO = "jinziyou/wonita"
const REF = process.env.SERVER_REF ?? "main"
const REMOTE_URL = `https://raw.githubusercontent.com/${REPO}/${REF}/super/server/openapi.json`

async function load() {
  const forcedLocal = process.env.SERVER_LOCAL
  if (forcedLocal) {
    console.log(`[sync] SERVER_LOCAL=${forcedLocal}`)
    return readFileSync(forcedLocal, "utf-8")
  }
  if (existsSync(DEFAULT_LOCAL)) {
    console.log(`[sync] 使用本地: ${DEFAULT_LOCAL}`)
    return readFileSync(DEFAULT_LOCAL, "utf-8")
  }
  console.log(`[sync] 本地不存在, 拉远端: ${REMOTE_URL}`)
  const res = await fetch(REMOTE_URL)
  if (!res.ok) {
    throw new Error(`拉取失败 ${res.status}: ${REMOTE_URL}`)
  }
  return await res.text()
}

async function main() {
  let raw
  try {
    raw = await load()
  } catch (e) {
    console.error(`[sync] ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }
  // 校验是合法 JSON
  try {
    JSON.parse(raw)
  } catch (e) {
    console.error(`[sync] 内容不是合法 JSON: ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }
  if (!raw.endsWith("\n")) raw += "\n"
  mkdirSync(dirname(OUTPUT), { recursive: true })
  writeFileSync(OUTPUT, raw, "utf-8")
  console.log(`[sync] 已写入 ${OUTPUT}`)
}

main()
