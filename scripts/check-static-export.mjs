import { readdir, stat } from "node:fs/promises"
import path from "node:path"

const HELP = `用法:
  pnpm verify:static-export
  node scripts/check-static-export.mjs

说明:
  检查 out/ 是否包含关键静态入口与 _next/static/chunks/*.js。
  该脚本不执行构建；如 out/ 不存在，先运行 pnpm build。
`

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP.trimEnd())
  process.exit(0)
}
if (args.length > 0) {
  console.error(`[check-static-export] 未知参数: ${args.join(" ")}`)
  process.exit(1)
}

const outDir = path.join(process.cwd(), "out")
const requiredFiles = [
  "index.html",
  "home.html",
  "home/notes.html",
  "home/resources.html",
  "home/following.html",
  "activity/spaces.html",
  "activity/tasks.html",
  "activity/deleted.html",
  "apps/local-apps.html",
  "settings/basic.html",
  "settings/ai.html",
  "code.html",
]

async function isFile(file) {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

async function hasStaticChunk() {
  const chunkDir = path.join(outDir, "_next", "static", "chunks")
  try {
    const entries = await readdir(chunkDir, { withFileTypes: true })
    return entries.some((entry) => entry.isFile() && entry.name.endsWith(".js"))
  } catch {
    return false
  }
}

const missing = []
for (const file of requiredFiles) {
  const full = path.join(outDir, file)
  if (!(await isFile(full))) missing.push(file)
}

let outStats = null
try {
  outStats = await stat(outDir)
} catch {
  missing.push("out/")
}

if (outStats && !outStats.isDirectory()) missing.push("out/ is not a directory")
if (!(await hasStaticChunk())) missing.push("_next/static/chunks/*.js")

if (missing.length) {
  console.error(`[check-static-export] 静态导出产物不完整: ${missing.join(", ")}`)
  process.exit(1)
}

console.log(`[check-static-export] out/ 产物检查通过 (${requiredFiles.length} 个关键入口)`)
