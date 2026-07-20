import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DOCS_DIR = path.join(ROOT, "docs")
const HELP = `用法:
  pnpm lint:docs
  node scripts/check-docs.mjs

说明:
  检查 README、docs/ 与安全文档中的仓库内 Markdown 链接，并确保 docs/README.md
  收录每一份顶层文档。外部 URL 与纯锚点不做网络校验。
`

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP.trimEnd())
  process.exit(0)
}
if (args.length > 0) {
  console.error(`[lint:docs] 未知参数: ${args.join(" ")}`)
  process.exit(1)
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) return markdownFiles(target)
      return entry.isFile() && entry.name.endsWith(".md") ? [target] : []
    }),
  )
  return nested.flat()
}

function repositoryPath(file) {
  return path.relative(ROOT, file).split(path.sep).join("/")
}

function withoutCodeFences(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "")
}

function markdownTargets(markdown) {
  const targets = []
  const pattern = /!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g
  for (const match of withoutCodeFences(markdown).matchAll(pattern)) {
    targets.push(match[1].replace(/^<|>$/g, ""))
  }
  return targets
}

function localTarget(source, rawTarget) {
  if (rawTarget.startsWith("#") || /^(?:https?|mailto|tel|data|javascript):/i.test(rawTarget)) {
    return null
  }
  const filePart = rawTarget.split("#", 1)[0].split("?", 1)[0]
  if (!filePart) return null
  let decoded
  try {
    decoded = decodeURIComponent(filePart)
  } catch {
    throw new Error(`链接包含无效 URL 编码: ${rawTarget}`)
  }
  return decoded.startsWith("/")
    ? path.resolve(ROOT, decoded.slice(1))
    : path.resolve(path.dirname(source), decoded)
}

function insideRepository(target) {
  const relative = path.relative(ROOT, target)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

const sources = [
  path.join(ROOT, "README.md"),
  path.join(ROOT, ".github", "SECURITY.md"),
  ...(await markdownFiles(DOCS_DIR)),
].sort()
const failures = []
let checkedLinks = 0
const indexTargets = new Set()

for (const source of sources) {
  const markdown = await readFile(source, "utf8")
  for (const rawTarget of markdownTargets(markdown)) {
    let target
    try {
      target = localTarget(source, rawTarget)
    } catch (error) {
      failures.push(`${repositoryPath(source)}: ${error.message}`)
      continue
    }
    if (!target) continue
    checkedLinks += 1
    if (!insideRepository(target)) {
      failures.push(`${repositoryPath(source)}: 链接越出仓库边界: ${rawTarget}`)
      continue
    }
    try {
      await stat(target)
      if (source === path.join(DOCS_DIR, "README.md")) indexTargets.add(target)
    } catch {
      failures.push(`${repositoryPath(source)}: 目标不存在: ${rawTarget}`)
    }
  }
}

const topLevelDocs = (await readdir(DOCS_DIR, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
  .map((entry) => path.join(DOCS_DIR, entry.name))
  .sort()
for (const document of topLevelDocs) {
  if (!indexTargets.has(document)) {
    failures.push(`docs/README.md: 未收录顶层文档 ${repositoryPath(document)}`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[lint:docs] ${failure}`)
  process.exit(1)
}

console.log(`[lint:docs] ${sources.length} 份文档、${checkedLinks} 个仓库内链接通过`)
