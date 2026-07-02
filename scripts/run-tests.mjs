// 跑 src/ 下全部 *.test.ts —— 用 node:test 程序化 run({ files }),不走 CLI glob。
// 原因: 部分发行版打包的 Node 22(如 Debian/Kali)缺内部模块 internal/deps/brace-expansion,
// `node --test <pattern>` 连显式文件参数都会初始化内部 glob 而崩溃; run({ files }) 不经过 glob,
// 官方与发行版 Node 都能跑。tsx loader 由父进程 execArgv 传递给各测试子进程。
// 用法: node --import tsx scripts/run-tests.mjs [路径过滤子串...] (即 pnpm test [子串])
import { readdirSync } from "node:fs"
import path from "node:path"
import { run } from "node:test"
import { spec } from "node:test/reporters"
import { fileURLToPath } from "node:url"

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src")
const filters = process.argv.slice(2)
const files = readdirSync(srcDir, { recursive: true })
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => path.join(srcDir, f))
  .filter((f) => filters.length === 0 || filters.some((s) => f.includes(s)))

if (files.length === 0) {
  console.error("未找到匹配的测试文件 (src/**/*.test.ts)")
  process.exit(1)
}

const stream = run({ files, concurrency: true })
stream.on("test:fail", () => {
  process.exitCode = 1
})
stream.compose(spec).pipe(process.stdout)
