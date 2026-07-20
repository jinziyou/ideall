import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { gzipSync } from "node:zlib"

import { bundleBudgetViolations, formatBytes, measureBundle } from "./check-bundle-budget.mjs"

async function withTempDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "ideall-bundle-budget-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test("measureBundle includes nested JavaScript chunks", async (t) => {
  const directory = await withTempDirectory(t)
  const first = Buffer.from("const first = 1;\n".repeat(20))
  const second = Buffer.from("const second = 2;\n".repeat(5))
  await mkdir(path.join(directory, "app"))
  await Promise.all([
    writeFile(path.join(directory, "first.js"), first),
    writeFile(path.join(directory, "app", "second.js"), second),
    writeFile(path.join(directory, "ignored.css"), "body {}"),
  ])

  const stats = await measureBundle(directory)

  assert.equal(stats.chunkCount, 2)
  assert.equal(stats.totalBytes, first.byteLength + second.byteLength)
  assert.equal(stats.totalGzipBytes, gzipSync(first).byteLength + gzipSync(second).byteLength)
  assert.equal(stats.largestChunk.file, "first.js")
})

test("bundleBudgetViolations reports each exceeded limit", () => {
  const stats = {
    totalBytes: 101,
    totalGzipBytes: 51,
    largestChunk: { file: "large.js", bytes: 81, gzipBytes: 41 },
    largestGzipChunk: { file: "large.js", bytes: 81, gzipBytes: 41 },
  }
  const violations = bundleBudgetViolations(stats, {
    totalBytes: 100,
    largestChunkBytes: 80,
    totalGzipBytes: 50,
    largestChunkGzipBytes: 40,
  })

  assert.equal(violations.length, 4)
  assert.match(violations[0], /total raw size/)
  assert.equal(formatBytes(1_500_000), "1.50 MB")
})

test("measureBundle rejects missing and empty output", async (t) => {
  const directory = await withTempDirectory(t)

  await assert.rejects(measureBundle(path.join(directory, "missing")), /does not exist/)
  await assert.rejects(measureBundle(directory), /No JavaScript chunks/)
})
