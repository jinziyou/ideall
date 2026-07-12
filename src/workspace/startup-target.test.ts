import { test } from "node:test"
import assert from "node:assert/strict"
import { fileRefKey } from "@protocol/file-system"
import {
  DEFAULT_STARTUP_TARGET,
  parseStartupTarget,
  readStartupTarget,
  resetStartupTarget,
  writeStartupTarget,
} from "./startup-target"

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

test("startup target: persists arbitrary file + engine and normalizes legacy roots", () => {
  const storage = memoryStorage()
  const target = {
    ref: { fileSystemId: "third-party.demo", fileId: "42" },
    engineId: "demo.timeline",
    rootId: "mount:demo",
  }
  assert.equal(writeStartupTarget(storage, target), true)
  assert.deepEqual(readStartupTarget(storage), { ...target, rootId: "apps" })
  assert.equal(resetStartupTarget(storage), true)
  assert.deepEqual(readStartupTarget(storage), DEFAULT_STARTUP_TARGET)
})

test("startup target: corrupted data falls back to Home", () => {
  assert.equal(parseStartupTarget("not-json"), null)
  assert.equal(
    parseStartupTarget(JSON.stringify({ file: fileRefKey(DEFAULT_STARTUP_TARGET.ref) })),
    null,
  )
})

test("startup target: legacy system root is inferred from its file", () => {
  const legacy = (panel: string) =>
    JSON.stringify({
      file: fileRefKey({ fileSystemId: "ideall.core", fileId: `panel:${panel}` }),
      engineId: "ideall.panel",
      rootId: "system",
    })

  assert.equal(parseStartupTarget(legacy("settings"))?.rootId, "settings")
  assert.equal(parseStartupTarget(legacy("trash"))?.rootId, "activity")
  assert.equal(parseStartupTarget(legacy("code"))?.rootId, "apps")
})
