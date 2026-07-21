import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, test } from "node:test"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CHECK_STATIC_EXPORT = path.join(ROOT, "scripts", "check-static-export.mjs")
const REQUIRED_FILES = [
  "index.html",
  "home.html",
  "home/notes.html",
  "home/resources.html",
  "home/following.html",
  "activity/spaces.html",
  "activity/tasks.html",
  "activity/deleted.html",
  "apps/local-apps.html",
  "settings/basic.html",
  "settings/ai.html",
  "community/publication.html",
  "code.html",
]
const tempRoots = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createFixture({ requiredDirectory = null, chunkDirectory = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "ideall-static-export-test-"))
  tempRoots.push(root)
  const out = path.join(root, "out")
  for (const relative of REQUIRED_FILES) {
    const target = path.join(out, relative)
    await mkdir(path.dirname(target), { recursive: true })
    if (relative === requiredDirectory) await mkdir(target)
    else await writeFile(target, relative)
  }

  const chunks = path.join(out, "_next", "static", "chunks")
  await mkdir(chunks, { recursive: true })
  const chunk = path.join(chunks, "app.js")
  if (chunkDirectory) await mkdir(chunk)
  else await writeFile(chunk, "export {}")
  return root
}

function runCheck(cwd, args = []) {
  return spawnSync(process.execPath, [CHECK_STATIC_EXPORT, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 2_000,
  })
}

test("check-static-export accepts a complete static export", async () => {
  const root = await createFixture()
  const result = runCheck(root)
  assert.equal(result.status, 0, result.stderr)
})

test("check-static-export rejects unknown arguments before inspecting output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ideall-static-export-test-"))
  tempRoots.push(root)
  const result = runCheck(root, ["--definitely-unknown"])
  assert.equal(result.status, 1)
})

test("check-static-export requires regular HTML and JavaScript files", async () => {
  const htmlDirectoryRoot = await createFixture({ requiredDirectory: "index.html" })
  const htmlResult = runCheck(htmlDirectoryRoot)
  assert.equal(htmlResult.status, 1)

  const chunkDirectoryRoot = await createFixture({ chunkDirectory: true })
  const chunkResult = runCheck(chunkDirectoryRoot)
  assert.equal(chunkResult.status, 1)
})

test("check-static-export requires canonical navigation pages", async () => {
  for (const relative of [
    "home/following.html",
    "activity/spaces.html",
    "activity/tasks.html",
    "activity/deleted.html",
    "apps/local-apps.html",
    "settings/basic.html",
    "settings/ai.html",
    "community/publication.html",
    "home/resources.html",
  ]) {
    const root = await createFixture()
    await rm(path.join(root, "out", relative))

    const result = runCheck(root)
    assert.equal(result.status, 1, `${relative} should be required`)
  }
})
