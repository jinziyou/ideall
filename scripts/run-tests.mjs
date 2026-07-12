// 跑 src/ 下全部 *.test.ts。每个文件独立进程执行，避免共享全局 registry / IndexedDB mock；
// runner 负责有限并发、单文件超时、进程组回收与有限日志，tsx loader 由 execArgv 透传。
import { availableParallelism } from "node:os"
import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runCapturedProcess } from "./script-utils.mjs"

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SRC_DIR = path.join(path.dirname(SCRIPT_PATH), "..", "src")
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_LOG_LIMIT_KB = 256
const DEFAULT_SLOW_COUNT = 8
const DEFAULT_TERM_GRACE_MS = 2_000
const DEFAULT_KILL_GRACE_MS = 1_000

const HELP = `用法:
  pnpm test
  pnpm test <路径或文件名子串...>
  pnpm test -- --timeout-ms 120000 --log-limit-kb 256 --slow-count 8

选项:
  --timeout-ms <n>   单个测试文件的最长运行时间（默认 ${DEFAULT_TIMEOUT_MS}）
  --log-limit-kb <n> 每个 stdout/stderr 最多保留的尾部 KiB（默认 ${DEFAULT_LOG_LIMIT_KB}）
  --slow-count <n>   慢测试摘要最多显示数量（默认 ${DEFAULT_SLOW_COUNT}，0 为关闭）

环境变量:
  IDEALL_TEST_TIMEOUT_MS
  IDEALL_TEST_LOG_LIMIT_KB
  IDEALL_TEST_SLOW_COUNT
  IDEALL_TEST_TERM_GRACE_MS
  IDEALL_TEST_KILL_GRACE_MS

说明:
  运行 src/**/*.test.ts。传入一个或多个子串时，只运行路径包含任一子串的测试文件。
  agent-mcp-external.test.ts 与 agent-mcp-stdio.test.ts 会在并发批次后串行运行。
`

// MCP 端到端传输测试会启动真实 SDK server/子进程；在全文件并发 runner 下不稳定，收尾串行跑。
const SERIAL_TEST_FILE_NAMES = new Set(["agent-mcp-external.test.ts", "agent-mcp-stdio.test.ts"])

function integerSetting(raw, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}..${max} 的整数`)
  }
  return value
}

function envSetting(env, key, fallback, range) {
  return env[key] === undefined ? fallback : integerSetting(env[key], key, range)
}

export function parseRunnerArgs(argv, env = process.env) {
  const help = argv.includes("--help") || argv.includes("-h")
  // 帮助入口必须能在环境变量配置损坏时用于排障，因此只在实际运行时读取覆盖值。
  const settingsEnv = help ? {} : env
  const options = {
    timeoutMs: envSetting(settingsEnv, "IDEALL_TEST_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, {
      min: 100,
      max: 60 * 60 * 1000,
    }),
    logLimitBytes:
      envSetting(settingsEnv, "IDEALL_TEST_LOG_LIMIT_KB", DEFAULT_LOG_LIMIT_KB, {
        min: 1,
        max: 64 * 1024,
      }) * 1024,
    slowCount: envSetting(settingsEnv, "IDEALL_TEST_SLOW_COUNT", DEFAULT_SLOW_COUNT, {
      min: 0,
      max: 100,
    }),
    termGraceMs: envSetting(settingsEnv, "IDEALL_TEST_TERM_GRACE_MS", DEFAULT_TERM_GRACE_MS, {
      min: 10,
      max: 60_000,
    }),
    killGraceMs: envSetting(settingsEnv, "IDEALL_TEST_KILL_GRACE_MS", DEFAULT_KILL_GRACE_MS, {
      min: 10,
      max: 60_000,
    }),
    filters: [],
    help,
  }
  if (help) return options

  const valueOptions = new Map([
    ["--timeout-ms", ["timeoutMs", 100, 60 * 60 * 1000, 1]],
    ["--log-limit-kb", ["logLimitBytes", 1, 64 * 1024, 1024]],
    ["--slow-count", ["slowCount", 0, 100, 1]],
  ])
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === "--") continue
    const equals = argument.startsWith("--") ? argument.indexOf("=") : -1
    const optionName = equals > 0 ? argument.slice(0, equals) : argument
    const spec = valueOptions.get(optionName)
    if (spec) {
      const raw = equals > 0 ? argument.slice(equals + 1) : argv[++index]
      if (raw === undefined) throw new Error(`${optionName} 缺少参数`)
      const [property, min, max, multiplier] = spec
      options[property] = integerSetting(raw, optionName, { min, max }) * multiplier
      continue
    }
    if (argument.startsWith("-")) throw new Error(`未知选项: ${argument}`)
    options.filters.push(argument)
  }
  return options
}

function isSerialTestFile(file) {
  return SERIAL_TEST_FILE_NAMES.has(path.basename(file))
}

function formatDuration(durationMs) {
  return durationMs < 1_000 ? `${durationMs}ms` : `${(durationMs / 1_000).toFixed(2)}s`
}

export function runTestFile(
  file,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    logLimitBytes = DEFAULT_LOG_LIMIT_KB * 1024,
    termGraceMs = DEFAULT_TERM_GRACE_MS,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    env = process.env,
    execArgv = process.execArgv,
  } = {},
) {
  return runCapturedProcess(process.execPath, [file], {
    env,
    execArgv,
    timeoutMs,
    termTimeoutMs: termGraceMs,
    killTimeoutMs: killGraceMs,
    maxOutputBytes: logLimitBytes,
  })
}

function passed(result) {
  return (
    !result.timedOut &&
    !result.error &&
    result.code === 0 &&
    !result.signal &&
    result.processTreeStopped
  )
}

function failureSuffix(result, timeoutMs) {
  if (result.timedOut) {
    return ` (timeout ${formatDuration(timeoutMs)}${result.forced ? ", forced kill" : ""})`
  }
  if (result.error) return ` (spawn error: ${result.error.message})`
  if (!result.processTreeStopped) return " (process tree still alive)"
  if (result.signal) return ` (${result.signal})`
  return ` (exit ${result.code ?? "unknown"})`
}

async function runBatch(batch, options, results, { concurrency }) {
  if (batch.length === 0) return
  const workerCount = concurrency ? Math.min(batch.length, availableParallelism(), 8) : 1
  let nextIndex = 0

  async function worker() {
    while (nextIndex < batch.length) {
      const file = batch[nextIndex++]
      const relative = path.relative(process.cwd(), file)
      console.log(`START ${relative}`)
      const result = await runTestFile(file, options)
      results.push({ file, relative, ...result })
      if (passed(result)) {
        console.log(`PASS  ${relative} (${formatDuration(result.durationMs)})`)
        if (result.stderr.text) process.stderr.write(result.stderr.text)
        continue
      }

      process.exitCode = 1
      console.error(
        `FAIL  ${relative} (${formatDuration(result.durationMs)})${failureSuffix(result, options.timeoutMs)}`,
      )
      if (result.stdout.text) process.stdout.write(result.stdout.text)
      if (result.stderr.text) process.stderr.write(result.stderr.text)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
}

function printSummary(results, wallDurationMs, slowCount) {
  const successes = results.filter(passed).length
  const failures = results.length - successes
  if (slowCount > 0 && results.length > 0) {
    console.log(`\nSLOWEST ${Math.min(slowCount, results.length)} TEST FILES`)
    for (const result of [...results]
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, slowCount)) {
      console.log(`  ${formatDuration(result.durationMs).padStart(8)}  ${result.relative}`)
    }
  }
  console.log(
    `\nSUMMARY ${successes} passed, ${failures} failed, ${results.length} total (${formatDuration(wallDurationMs)} wall)`,
  )
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let options
  try {
    options = parseRunnerArgs(argv, env)
  } catch (error) {
    console.error(`test runner: ${error.message}`)
    process.exitCode = 1
    return
  }
  if (options.help) {
    console.log(HELP.trimEnd())
    return
  }

  const files = readdirSync(SRC_DIR, { recursive: true })
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => path.join(SRC_DIR, file))
    .filter(
      (file) =>
        options.filters.length === 0 || options.filters.some((filter) => file.includes(filter)),
    )
    .sort()
  if (files.length === 0) {
    console.error("未找到匹配的测试文件 (src/**/*.test.ts)")
    process.exitCode = 1
    return
  }

  const startedAt = Date.now()
  const results = []
  const parallelFiles = files.filter((file) => !isSerialTestFile(file))
  const serialFiles = files.filter(isSerialTestFile)
  await runBatch(parallelFiles, options, results, { concurrency: true })
  await runBatch(serialFiles, options, results, { concurrency: false })
  printSummary(results, Date.now() - startedAt, options.slowCount)
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) await main()
