// 跑 src/ 下全部 *.test.ts —— 用 node:test 程序化 run({ files }),不走 CLI glob。
// 原因: 部分发行版打包的 Node 22(如 Debian/Kali)缺内部模块 internal/deps/brace-expansion,
// `node --test <pattern>` 连显式文件参数都会初始化内部 glob 而崩溃; run({ files }) 不经过 glob,
// 官方与发行版 Node 都能跑。tsx loader 由父进程 execArgv 传递给测试 worker。
// 用法: node --import tsx scripts/run-tests.mjs [路径过滤子串...] (即 pnpm test [子串])
import { spawn } from "node:child_process"
import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HELP = `用法:
  pnpm test
  pnpm test <路径或文件名子串...>
  node --import tsx scripts/run-tests.mjs <路径或文件名子串...>

说明:
  运行 src/**/*.test.ts。传入一个或多个子串时，只运行路径包含任一子串的测试文件。
  agent-mcp-external.test.ts 与 agent-mcp-stdio.test.ts 会在并发批次后串行运行。
`

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP.trimEnd())
  process.exit(0)
}

const testWorkerSource = `
import { run } from "node:test"
import { spec } from "node:test/reporters"

const concurrency = process.argv[1] === "true"
const files = process.argv.slice(2)

const stream = run({ files, concurrency })
stream.on("test:fail", () => {
  process.exitCode = 1
})
stream.on("error", (error) => {
  console.error(error)
  process.exitCode = 1
})
stream.compose(spec).pipe(process.stdout)
`

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src")
const filters = args
// MCP 端到端传输测试会启动真实 SDK server/子进程; 在全文件并发 runner 下不稳定, 收尾后串行跑。
const serialTestFileNames = new Set(["agent-mcp-external.test.ts", "agent-mcp-stdio.test.ts"])
const files = readdirSync(srcDir, { recursive: true })
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => path.join(srcDir, f))
  .filter((f) => filters.length === 0 || filters.some((s) => f.includes(s)))

if (files.length === 0) {
  console.error("未找到匹配的测试文件 (src/**/*.test.ts)")
  process.exit(1)
}

function isSerialTestFile(file) {
  return serialTestFileNames.has(path.basename(file))
}

async function runBatch(batch, { concurrency }) {
  if (batch.length === 0) return
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        "--input-type=module",
        "-e",
        testWorkerSource,
        String(concurrency),
        ...batch,
      ],
      { stdio: "inherit" },
    )
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code !== 0 || signal) process.exitCode = code ?? 1
      resolve()
    })
  })
}

const parallelFiles = files.filter((f) => !isSerialTestFile(f))
const serialFiles = files.filter(isSerialTestFile)

await runBatch(parallelFiles, { concurrency: true })
await runBatch(serialFiles, { concurrency: false })
