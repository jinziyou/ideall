import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { createLinter } from "actionlint"

const workflowDir = path.join(process.cwd(), ".github", "workflows")
const entries = await readdir(workflowDir, { withFileTypes: true })
const files = entries
  .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
  .map((entry) => path.join(workflowDir, entry.name))
  .sort()

if (!files.length) {
  console.error("未找到 GitHub Actions workflow 文件")
  process.exit(1)
}

const lint = await createLinter()
let failed = false

for (const file of files) {
  const input = await readFile(file, "utf8")
  const results = lint(input, file)
  for (const result of results) {
    if (isKnownFalsePositive(result)) continue
    failed = true
    console.error(
      `${result.file}:${result.line}:${result.column}: ${result.message} [${result.kind}]`,
    )
  }
}

if (failed) process.exit(1)
console.log(`actionlint: ${files.length} workflow 文件通过`)

function isKnownFalsePositive(result) {
  // The actionlint WASM package used here does not yet include GitHub's `vars`
  // context in its expression context table. Repository/org variables are valid
  // in workflow expressions, so keep the rest of actionlint strict and suppress
  // only this stale-context diagnostic.
  return result.kind === "expression" && result.message.includes('undefined variable "vars"')
}
