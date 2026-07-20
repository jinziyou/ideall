import { rm } from "node:fs/promises"
import path from "node:path"

const HELP = `用法:
  node scripts/clean-next.mjs
  pnpm clean:next

说明:
  删除仓库根目录下的 .next/ 构建缓存与类型产物。
  用于 verify:base 在 typecheck 前清掉旧的 Next 生成类型，避免脏缓存影响本地门禁。
`

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP.trimEnd())
  process.exit(0)
}

if (args.length) {
  console.error(`[clean-next] 未知参数: ${args.join(" ")}`)
  console.error("运行 node scripts/clean-next.mjs --help 查看用法")
  process.exit(1)
}

const nextDir = path.join(process.cwd(), ".next")
await rm(nextDir, { recursive: true, force: true })
console.log("[clean-next] 已清理 .next/")
