/**
 * 把后端 (wonita 服务) 导出的 openapi.json 刷新到本仓库 openapi/server.json。
 *
 * openapi/server.json 已随仓库提交, 是类型 codegen (`pnpm gen:api`) 的契约源 ——
 * 普通使用者与贡献者**无需运行本脚本**即可 build / typecheck / 出包。
 *
 * 本脚本仅供能拿到后端 openapi 导出的维护者在契约更新后刷新该文件:
 *
 *     SERVER_LOCAL=/abs/path/to/openapi.json pnpm sync:api
 *
 * 未提供 SERVER_LOCAL 时不做任何远程拉取, 直接以已提交的 openapi/server.json 为准并提示。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const APP_ROOT = resolve(__dirname, "..")
const OUTPUT = resolve(APP_ROOT, "openapi/server.json")

function loadSource() {
  const forced = process.env.SERVER_LOCAL
  if (!forced) return null
  if (!existsSync(forced)) {
    console.error(`[sync] SERVER_LOCAL 指向的文件不存在: ${forced}`)
    process.exit(1)
  }
  console.log(`[sync] 使用 SERVER_LOCAL: ${forced}`)
  return readFileSync(forced, "utf-8")
}

function main() {
  const raw = loadSource()
  if (raw == null) {
    console.log(
      "[sync] 未设置 SERVER_LOCAL —— openapi/server.json 已是仓库内提交的契约源, 无需同步。\n" +
        "        如需用新的后端契约刷新: SERVER_LOCAL=/abs/path/to/openapi.json pnpm sync:api",
    )
    return
  }
  try {
    JSON.parse(raw)
  } catch (e) {
    console.error(`[sync] 内容不是合法 JSON: ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }
  const out = raw.endsWith("\n") ? raw : raw + "\n"
  mkdirSync(dirname(OUTPUT), { recursive: true })
  writeFileSync(OUTPUT, out, "utf-8")
  console.log(`[sync] 已写入 ${OUTPUT}`)
}

main()
