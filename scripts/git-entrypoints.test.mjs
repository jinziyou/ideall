import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function runScript(name, args) {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts", name), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 2_000,
  })
}

for (const [script, command] of [
  ["git-setup.mjs", "git:setup"],
  ["git-pull.mjs", "git:pull"],
]) {
  test(`${command} help exits before repository mutation`, () => {
    const result = runScript(script, ["--help"])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, new RegExp(`pnpm ${command.replace(":", "\\:")}`))
  })

  test(`${command} rejects unknown arguments before repository mutation`, () => {
    const result = runScript(script, ["--unknown"])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /未知参数/)
  })
}
