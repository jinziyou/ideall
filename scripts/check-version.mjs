import { assertProjectVersions, loadProjectVersionState } from "./project-version.mjs"

const HELP = `用法:
  node scripts/check-version.mjs
  node scripts/check-version.mjs <expected-version>

说明:
  校验 package.json、tauri.conf.json、Cargo.toml 与 Cargo.lock 的项目版本一致。
  传 expected-version 时，还会校验四处版本与发版目标一致。
`

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP.trimEnd())
  process.exit(0)
}

if (args.length > 1) {
  console.error(HELP.trimEnd())
  process.exit(1)
}

try {
  const entries = loadProjectVersionState()
  const version = assertProjectVersions(entries, args[0])
  console.log(`✓ 项目版本一致: ${version} (${entries.map((entry) => entry.path).join(", ")})`)
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
