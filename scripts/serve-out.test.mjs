import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, test } from "node:test"
import { resolveFile } from "./serve-out.mjs"

const tempRoots = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createStaticExport() {
  const root = await mkdtemp(path.join(tmpdir(), "ideall-serve-out-test-"))
  tempRoots.push(root)
  await mkdir(path.join(root, "home", "notes"), { recursive: true })
  await Promise.all([
    writeFile(path.join(root, "index.html"), "index"),
    writeFile(path.join(root, "home.html"), "home"),
    writeFile(path.join(root, "home", "notes", "index.html"), "notes"),
  ])
  return root
}

test("resolveFile matches static-export routes and ignores query strings", async () => {
  const root = await createStaticExport()
  assert.equal(resolveFile("/", root), path.join(root, "index.html"))
  assert.equal(resolveFile("/home?tab=notes", root), path.join(root, "home.html"))
  assert.equal(resolveFile("/home/notes/", root), path.join(root, "home", "notes", "index.html"))
})

test("resolveFile rejects malformed encoding and path traversal", async () => {
  const root = await createStaticExport()
  assert.equal(resolveFile("/%", root), null)
  assert.equal(resolveFile("/%E0%A4%A", root), null)
  assert.equal(resolveFile("/%2e%2e/package.json", root), null)
})
