import { access, readdir, stat } from "node:fs/promises"
import path from "node:path"

const HELP = `用法:
  pnpm verify:static-export
  node scripts/check-static-export.mjs

说明:
  检查 out/ 是否包含关键静态入口与 _next/static/chunks/*.js。
  该脚本不执行构建；如 out/ 不存在，先运行 pnpm build。
`

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP.trimEnd())
  process.exit(0)
}

const outDir = path.join(process.cwd(), "out")
const requiredFiles = [
  "index.html",
  "home.html",
  "home/notes.html",
  "home/resources.html",
  "code.html",
  "trash.html",
]

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function hasStaticChunk() {
  const chunkDir = path.join(outDir, "_next", "static", "chunks")
  try {
    const entries = await readdir(chunkDir)
    return entries.some((entry) => entry.endsWith(".js"))
  } catch {
    return false
  }
}

const missing = []
for (const file of requiredFiles) {
  const full = path.join(outDir, file)
  if (!(await exists(full))) missing.push(file)
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
