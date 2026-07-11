// 跑 src/ 下全部 *.test.ts。每个文件直接交给 Node 执行，不使用 `node --test` 的 CLI glob，
// 兼容缺少 internal/deps/brace-expansion 的发行版 Node。node:test 在普通 Node 进程中仍会
// 执行并正确设置退出码；tsx loader 由父进程 execArgv 传给各子进程。
// 用法: node --import tsx scripts/run-tests.mjs [路径过滤子串...] (即 pnpm test [子串])
import { spawn } from "node:child_process"
import { readdirSync } from "node:fs"
import { availableParallelism } from "node:os"
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
  const workerCount = concurrency ? Math.min(batch.length, availableParallelism(), 8) : 1
  let nextIndex = 0

  async function worker() {
    while (nextIndex < batch.length) {
      const file = batch[nextIndex++]
      const result = await runTestFile(file)
      const relative = path.relative(process.cwd(), file)
      if (result.code === 0 && !result.signal) {
        console.log(`PASS ${relative}`)
        if (result.stderr) process.stderr.write(result.stderr)
        continue
      }

      process.exitCode = result.code ?? 1
      console.error(`FAIL ${relative}${result.signal ? ` (${result.signal})` : ""}`)
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
}

function runTestFile(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, file], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

const parallelFiles = files.filter((f) => !isSerialTestFile(f))
const serialFiles = files.filter(isSerialTestFile)

await runBatch(parallelFiles, { concurrency: true })
await runBatch(serialFiles, { concurrency: false })
