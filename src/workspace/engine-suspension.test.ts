import assert from "node:assert/strict"
import { test } from "node:test"
import {
  MAX_ENGINE_SUSPEND_SNAPSHOT_BYTES,
  MAX_ENGINE_SUSPEND_SNAPSHOTS,
  MAX_ENGINE_SUSPEND_TOTAL_BYTES,
  clearEngineSuspendSnapshot,
  readEngineSuspendSnapshot,
  writeEngineSuspendSnapshot,
} from "./engine-suspension"

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const isDraft = (value: unknown): value is { draft: string } =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as { draft?: unknown }).draft === "string"

test("engine suspension: round-trips only the exact tab/engine/file identity", () => {
  const storage = new MemoryStorage()
  assert.equal(
    writeEngineSuspendSnapshot({
      tabId: "tab-a",
      engineId: "ideall.code",
      fileKey: "fs:file",
      payload: { draft: "local" },
      storage,
    }),
    true,
  )
  assert.deepEqual(
    readEngineSuspendSnapshot({
      tabId: "tab-a",
      engineId: "ideall.code",
      fileKey: "fs:file",
      validate: isDraft,
      storage,
    }),
    { draft: "local" },
  )
  assert.equal(
    readEngineSuspendSnapshot({
      tabId: "tab-a",
      engineId: "other",
      fileKey: "fs:file",
      validate: isDraft,
      storage,
    }),
    null,
  )
})

test("engine suspension: oversized or malformed snapshots fail closed", () => {
  const storage = new MemoryStorage()
  assert.equal(
    writeEngineSuspendSnapshot({
      tabId: "large",
      engineId: "ideall.code",
      fileKey: "fs:file",
      payload: { draft: "x".repeat(MAX_ENGINE_SUSPEND_SNAPSHOT_BYTES) },
      storage,
    }),
    false,
  )
  assert.equal(
    writeEngineSuspendSnapshot({
      tabId: "large-utf8",
      engineId: "ideall.code",
      fileKey: "fs:file",
      payload: { draft: "草".repeat(Math.floor(MAX_ENGINE_SUSPEND_SNAPSHOT_BYTES / 2)) },
      storage,
    }),
    false,
  )
  storage.setItem("ideall:engine-suspend:v1:bad", "not-json")
  assert.equal(
    readEngineSuspendSnapshot({
      tabId: "bad",
      engineId: "ideall.code",
      fileKey: "fs:file",
      validate: isDraft,
      storage,
    }),
    null,
  )
  clearEngineSuspendSnapshot("bad", storage)
  assert.equal(storage.length, 0)
})

test("engine suspension: enforces count and aggregate UTF-8 quotas", () => {
  const countStorage = new MemoryStorage()
  for (let index = 0; index < MAX_ENGINE_SUSPEND_SNAPSHOTS; index += 1) {
    assert.equal(
      writeEngineSuspendSnapshot({
        tabId: `count-${index}`,
        engineId: "ideall.code",
        fileKey: `fs:file-${index}`,
        payload: { draft: "small" },
        storage: countStorage,
      }),
      true,
    )
  }
  assert.equal(
    writeEngineSuspendSnapshot({
      tabId: "count-overflow",
      engineId: "ideall.code",
      fileKey: "fs:overflow",
      payload: { draft: "small" },
      storage: countStorage,
    }),
    false,
  )
  assert.equal(countStorage.length, MAX_ENGINE_SUSPEND_SNAPSHOTS)

  const totalStorage = new MemoryStorage()
  const chunk = "x".repeat(Math.floor(MAX_ENGINE_SUSPEND_TOTAL_BYTES / 6))
  for (let index = 0; index < 5; index += 1) {
    assert.equal(
      writeEngineSuspendSnapshot({
        tabId: `total-${index}`,
        engineId: "ideall.code",
        fileKey: `fs:file-${index}`,
        payload: { draft: chunk },
        storage: totalStorage,
      }),
      true,
    )
  }
  assert.equal(
    writeEngineSuspendSnapshot({
      tabId: "total-overflow",
      engineId: "ideall.code",
      fileKey: "fs:overflow",
      payload: { draft: chunk },
      storage: totalStorage,
    }),
    false,
  )
  assert.equal(totalStorage.length, 5)
})

test("engine suspension: rejects oversized foreign snapshots and malformed identities on read", () => {
  const storage = new MemoryStorage()
  const tabId = "foreign-large"
  storage.setItem(
    `ideall:engine-suspend:v1:${encodeURIComponent(tabId)}`,
    JSON.stringify({
      version: 1,
      tabId,
      engineId: "ideall.code",
      fileKey: "fs:file",
      updatedAt: 1,
      payload: { draft: "草".repeat(Math.floor(MAX_ENGINE_SUSPEND_SNAPSHOT_BYTES / 2)) },
    }),
  )
  assert.equal(
    readEngineSuspendSnapshot({
      tabId,
      engineId: "ideall.code",
      fileKey: "fs:file",
      validate: isDraft,
      storage,
    }),
    null,
  )
  assert.equal(storage.length, 0)
  assert.equal(
    readEngineSuspendSnapshot({
      tabId: "\ud800",
      engineId: "ideall.code",
      fileKey: "fs:file",
      validate: isDraft,
      storage,
    }),
    null,
  )
})
