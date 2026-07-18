import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..")

/**
 * 现存直接访问均为存储适配器、启动前内联主题脚本、session 草稿或历史迁移边界。
 * 新功能必须经 public-config / secure-store / 专用领域 store，不得扩张此清单。
 */
export const ALLOWED_DIRECT_STORAGE_ACCESS = Object.freeze({
  "src/files/stores/notes-store.ts": "旧笔记键一次性迁移",
  "src/lib/theme.ts": "hydration 前同步主题内联脚本",
  "src/modules/tool/quick-jump.tsx": "最近搜索领域 store",
  "src/plugins/agent/lib/acp/acp-settings.ts": "ACP 设置领域 store",
  "src/plugins/agent/lib/agent-collection.ts": "agent 集合领域 store",
  "src/plugins/agent/lib/agent-oauth.ts": "OAuth 状态与遗留值迁移边界",
  "src/plugins/shared/workspace-archive.ts": "工作区布局归档适配器",
  "src/workspace/store/persistence.ts": "工作区布局读取适配器",
  "src/workspace/viewers/file-draft.ts": "session-only 文件草稿 store",
  "src/workspace/workspace-persist.ts": "工作区布局写入适配器",
  "src/workspace/recently-used.ts": "最近使用领域 store（显式开关的访问记录）",
})

const DIRECT_STORAGE_CALL =
  /\b(?:(?:globalThis|window)\s*\.\s*)?(?:localStorage|sessionStorage)\s*(?:\?\.|\.)\s*(?:getItem|setItem|removeItem|clear|key)\b/g

function maskComments(source) {
  const spaces = (value) => value.replace(/[^\n]/g, " ")
  return source.replace(/\/\*[\s\S]*?\*\//g, spaces).replace(/\/\/[^\n]*/g, spaces)
}

function sourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(absolute))
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(absolute)
    }
  }
  return files
}

export function findStorageAccessViolations(root = ROOT, allowed = ALLOWED_DIRECT_STORAGE_ACCESS) {
  const src = path.join(root, "src")
  const violations = []
  for (const file of sourceFiles(src)) {
    const relative = path.relative(root, file).split(path.sep).join("/")
    const source = readFileSync(file, "utf8")
    const matches = [...maskComments(source).matchAll(DIRECT_STORAGE_CALL)]
    if (matches.length === 0 || Object.hasOwn(allowed, relative)) continue
    for (const match of matches) {
      const line = source.slice(0, match.index).split("\n").length
      violations.push({ file: relative, line, access: match[0] })
    }
  }
  return violations
}

export function main(root = ROOT) {
  const violations = findStorageAccessViolations(root)
  if (violations.length === 0) {
    console.log(
      `storage access lint: ok (${Object.keys(ALLOWED_DIRECT_STORAGE_ACCESS).length} 个冻结适配器)`,
    )
    return
  }
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: 禁止直接访问 ${violation.access}`)
  }
  console.error("请改用 src/lib/public-config.ts、src/lib/secure-store.ts 或既有领域 store。")
  process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) main()
