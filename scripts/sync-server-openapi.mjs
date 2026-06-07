/**
 * 把 wonita 的 super/server/openapi.json 同步到本仓库 openapi/server.json。
 *
 * inode 已迁出 wonita monorepo 独立成本仓库 (myos)，但契约真相源仍是
 * 私有仓库 jinziyou/wonita 的 super/server/openapi.json。本脚本按以下顺序取源:
 *
 *   1. SERVER_LOCAL=/abs/path.json    — 强制使用指定本地文件 (CI 检出 wonita 后用)
 *   2. WONITA_ROOT=/path/to/wonita    — 指定本地 wonita 仓库根，取其 super/server/openapi.json
 *   3. ../wonita/super/server/openapi.json — 默认假设 myos 与 wonita 为同级目录
 *   4. 远端 GitHub API (私有仓库需 token):
 *        WONITA_TOKEN 或 GITHUB_TOKEN  — contents API + raw accept header
 *      无 token 时退化到匿名 raw URL (仅 wonita 公开时可用)。
 *
 * 用法:
 *
 *     pnpm sync:api                                  # 自动探测本地 / 远端
 *     SERVER_LOCAL=_wonita/super/server/openapi.json pnpm sync:api
 *     WONITA_ROOT=~/code/wonita pnpm sync:api
 *     WONITA_TOKEN=ghp_xxx pnpm sync:api             # 私有仓库远端拉取
 *     SERVER_REF=feat-x WONITA_TOKEN=ghp_xxx pnpm sync:api   # 指定分支/tag/commit
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const APP_ROOT = resolve(__dirname, "..")
const OUTPUT = resolve(APP_ROOT, "openapi/server.json")

const REPO = "jinziyou/wonita"
const SRC_PATH = "super/server/openapi.json"
const REF = process.env.SERVER_REF ?? "main"
const TOKEN = process.env.WONITA_TOKEN ?? process.env.GITHUB_TOKEN ?? ""

// 本地候选路径 (按优先级)
function localCandidates() {
  const out = []
  if (process.env.SERVER_LOCAL) out.push(resolve(process.env.SERVER_LOCAL))
  if (process.env.WONITA_ROOT) out.push(resolve(process.env.WONITA_ROOT, SRC_PATH))
  // myos 与 wonita 同级: <parent>/wonita/super/server/openapi.json
  out.push(resolve(APP_ROOT, "..", "wonita", SRC_PATH))
  return out
}

async function loadRemote() {
  // 私有仓库: GitHub contents API + raw accept header (token 必需)
  if (TOKEN) {
    const api = `https://api.github.com/repos/${REPO}/contents/${SRC_PATH}?ref=${REF}`
    console.log(`[sync] 拉远端 (API, 带 token): ${api}`)
    const res = await fetch(api, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/vnd.github.raw",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    if (!res.ok) throw new Error(`GitHub API 拉取失败 ${res.status}: ${api}`)
    return await res.text()
  }
  // 无 token: 匿名 raw (仅 wonita 公开时可用)
  const raw = `https://raw.githubusercontent.com/${REPO}/${REF}/${SRC_PATH}`
  console.log(`[sync] 无 token, 拉匿名 raw: ${raw}`)
  const res = await fetch(raw)
  if (!res.ok) {
    throw new Error(
      `匿名拉取失败 ${res.status}: ${raw}\n` +
        `wonita 为私有仓库时需设 WONITA_TOKEN (对其有 contents:read 的 PAT)。`,
    )
  }
  return await res.text()
}

async function load() {
  for (const p of localCandidates()) {
    if (existsSync(p)) {
      console.log(`[sync] 使用本地: ${p}`)
      return readFileSync(p, "utf-8")
    }
  }
  return await loadRemote()
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
