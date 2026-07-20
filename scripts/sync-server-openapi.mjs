/**
 * 把后端 (wonita 服务) 导出的 openapi.json 刷新到本仓库 openapi/server.json。
 *
 * openapi/server.json 已随仓库提交, 是类型 codegen (`pnpm gen:api`) 的契约源 ——
 * 普通使用者与贡献者**无需运行本脚本**即可 build / typecheck / 出包。
 *
 * 本脚本仅供能拿到后端 openapi 导出的维护者在契约更新后刷新该文件:
 *
 *     SERVER_LOCAL=/abs/path/to/openapi.json \
 *     SERVER_SOURCE_COMMIT=<40-hex-wonita-commit> pnpm sync:api
 *
 * 同步会同时写入 server.provenance.json；未提供 SERVER_LOCAL 时不做任何远程拉取,
 * 直接以已提交的 openapi/server.json 为准并提示。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  createServerOpenApiProvenance,
  DEFAULT_SERVER_ARTIFACT_PATH,
  DEFAULT_SERVER_SOURCE_PATH,
  DEFAULT_SERVER_SOURCE_REPOSITORY,
} from "./server-openapi-provenance.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const APP_ROOT = resolve(__dirname, "..")
const OUTPUT = resolve(APP_ROOT, "openapi/server.json")
const PROVENANCE_OUTPUT = resolve(APP_ROOT, "openapi/server.provenance.json")

export function syncServerOpenApi({
  sourceFile,
  sourceCommit,
  sourceRepository = DEFAULT_SERVER_SOURCE_REPOSITORY,
  sourcePath = DEFAULT_SERVER_SOURCE_PATH,
  outputFile = OUTPUT,
  provenanceFile = PROVENANCE_OUTPUT,
} = {}) {
  if (!sourceFile) return null
  if (!existsSync(sourceFile)) {
    throw new Error(`SERVER_LOCAL 指向的文件不存在: ${sourceFile}`)
  }
  const raw = readFileSync(sourceFile, "utf-8")
  try {
    JSON.parse(raw)
  } catch (error) {
    throw new Error(`内容不是合法 JSON: ${error instanceof Error ? error.message : error}`)
  }
  const output = raw.endsWith("\n") ? raw : raw + "\n"
  const provenance = createServerOpenApiProvenance({
    artifactContent: output,
    repository: sourceRepository,
    commit: sourceCommit,
    sourcePath,
    artifactPath: DEFAULT_SERVER_ARTIFACT_PATH,
  })
  mkdirSync(dirname(outputFile), { recursive: true })
  mkdirSync(dirname(provenanceFile), { recursive: true })
  writeFileSync(outputFile, output, "utf-8")
  writeFileSync(provenanceFile, `${JSON.stringify(provenance, null, 2)}\n`, "utf-8")
  return { outputFile, provenanceFile, provenance }
}

function main() {
  const sourceFile = process.env.SERVER_LOCAL
  if (!sourceFile) {
    console.log(
      "[sync] 未设置 SERVER_LOCAL —— openapi/server.json 已是仓库内提交的契约源, 无需同步。\n" +
        "        刷新时还需设置 SERVER_SOURCE_COMMIT，详见 docs/scripts.md。",
    )
    return
  }
  try {
    const result = syncServerOpenApi({
      sourceFile,
      sourceCommit: process.env.SERVER_SOURCE_COMMIT,
      sourceRepository: process.env.SERVER_SOURCE_REPOSITORY,
      sourcePath: process.env.SERVER_SOURCE_PATH,
    })
    console.log(`[sync] 使用 SERVER_LOCAL: ${sourceFile}`)
    console.log(`[sync] 已写入 ${result.outputFile}`)
    console.log(`[sync] 已写入 ${result.provenanceFile}`)
  } catch (error) {
    console.error(`[sync] ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) main()
