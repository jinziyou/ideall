import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ZERO_SHA = "0000000000000000000000000000000000000000"
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024
const HELP = `用法:
  node scripts/app-build-gate.mjs

说明:
  供 .github/workflows/app-build.yml 使用。根据 GitHub Actions 事件和完整 push
  变更集写出 build/rust 两个布尔 output；无法可靠比较提交时保守执行构建。
`

export function isBuildNeutralPath(file) {
  const normalized = file.split(path.sep).join("/")
  if (normalized === "LICENSE" || normalized.endsWith(".md")) return true
  if (normalized.startsWith("docs/")) return true
  if (normalized === ".github/dependabot.yml") return true
  if (
    normalized.startsWith(".github/workflows/") &&
    normalized !== ".github/workflows/app-build.yml"
  ) {
    return true
  }
  return (
    normalized === ".gitignore" ||
    normalized === ".prettierignore" ||
    normalized.startsWith(".prettierrc") ||
    normalized === ".editorconfig"
  )
}

export function classifyChangedPaths(paths) {
  const applicationPaths = paths.filter((file) => !isBuildNeutralPath(file))
  return {
    build: applicationPaths.length > 0,
    rust: paths.some((file) => file.startsWith("src-tauri/")),
    applicationPaths,
  }
}

export function immediateEventDecision({ eventName, ref, refType }) {
  if (refType === "tag") return { build: true, rust: true, reason: "release tag" }
  if (eventName === "workflow_dispatch") {
    if (ref !== "refs/heads/main") {
      throw new Error(`手动 edge 发布只允许从 main 运行，当前 ref=${ref || "<empty>"}`)
    }
    return { build: true, rust: true, reason: "manual main build" }
  }
  if (eventName !== "push") {
    return { build: true, rust: true, reason: `unrecognised event ${eventName || "<empty>"}` }
  }
  return null
}

function gitSucceeds(args) {
  const result = spawnSync("git", args, { stdio: "ignore" })
  return !result.error && result.status === 0
}

function changedPaths(before, sha) {
  const result = spawnSync("git", ["diff", "--name-only", "-z", before, sha, "--"], {
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  })
  if (result.error || result.status !== 0) return null
  return result.stdout.split("\0").filter(Boolean)
}

function writeDecision(outputFile, decision) {
  if (!outputFile) throw new Error("GITHUB_OUTPUT 未设置")
  appendFileSync(outputFile, `build=${decision.build}\nrust=${decision.rust}\n`, "utf8")
}

function conservativeDecision(reason) {
  console.log(`${reason} → 保守构建`)
  return { build: true, rust: true }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP.trimEnd())
    return
  }
  if (argv.length > 0) throw new Error(`未知参数: ${argv.join(" ")}`)

  const immediate = immediateEventDecision({
    eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    refType: env.GITHUB_REF_TYPE,
  })
  if (immediate) {
    console.log(`${immediate.reason} → 构建应用与 Rust`)
    writeDecision(env.GITHUB_OUTPUT, immediate)
    return
  }

  const before = env.BEFORE_SHA
  const sha = env.GITHUB_SHA
  let decision
  if (
    !before ||
    before === ZERO_SHA ||
    !sha ||
    !gitSucceeds(["cat-file", "-e", `${before}^{commit}`])
  ) {
    decision = conservativeDecision(`缺少有效 push base (${before || "<empty>"})`)
  } else {
    const paths = changedPaths(before, sha)
    if (!paths) {
      decision = conservativeDecision(`无法比较 ${before}..${sha}`)
    } else {
      decision = classifyChangedPaths(paths)
      if (decision.build) {
        console.log("含应用或发布链改动，构建:")
        for (const file of decision.applicationPaths) console.log(`  ${JSON.stringify(file)}`)
      } else {
        console.log("仅文档或非发布 workflow 配置改动 → 跳过 App 构建")
      }
    }
  }
  writeDecision(env.GITHUB_OUTPUT, decision)
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    main()
  } catch (error) {
    console.error(`[app-build-gate] ${error.message}`)
    process.exitCode = 1
  }
}
