// CI 卡点: 校验已提交的 src/lib/api/server.d.ts 与 openapi/server.json 的生成物一致。
// 生成步骤在 package.json 的 gen:api:check 里 (openapi-typescript 经 pnpm 的 PATH 调用,
// 输出到 node_modules/.cache/ideall/), 本脚本只做逐字节比较 —— 不依赖 /tmp 与 diff, 跨平台可用。
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const committedPath = path.join(root, "src", "lib", "api", "server.d.ts")
const freshPath = path.join(root, "node_modules", ".cache", "ideall", "server.gen.d.ts")

const committed = readFileSync(committedPath, "utf8")
const fresh = readFileSync(freshPath, "utf8")

if (committed !== fresh) {
  console.error(
    "✗ src/lib/api/server.d.ts 与 openapi/server.json 不一致 —— 请运行 pnpm gen:api 并提交生成物",
  )
  process.exit(1)
}
console.log("✓ server.d.ts 与 openapi/server.json 一致")
