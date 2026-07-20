import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, test } from "node:test"
import { discoverScriptTests, parseScriptTestArgs } from "./run-script-tests.mjs"

const tempRoots = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test("script test discovery is deterministic and only returns regular test modules", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ideall-script-tests-"))
  tempRoots.push(root)
  await Promise.all([
    writeFile(path.join(root, "z.test.mjs"), ""),
    writeFile(path.join(root, "a.test.mjs"), ""),
    writeFile(path.join(root, "helper.mjs"), ""),
    mkdir(path.join(root, "directory.test.mjs")),
  ])

  const files = await discoverScriptTests(root)
  assert.deepEqual(
    files.map((file) => path.basename(file)),
    ["a.test.mjs", "z.test.mjs"],
  )
})

test("script test filters and help are parsed before execution", () => {
  assert.deepEqual(parseScriptTestArgs(["--", "release", "version"]), {
    filters: ["release", "version"],
    help: false,
  })
  assert.deepEqual(parseScriptTestArgs(["--help"]), { filters: [], help: true })
  assert.throws(() => parseScriptTestArgs(["--unknown"]), /未知选项/)
})
