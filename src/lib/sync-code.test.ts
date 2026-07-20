import { test } from "node:test"
import assert from "node:assert/strict"
import { secureFallbackStorageKey } from "./secure-store"
import {
  SYNC_CODE_SECURE_KEY,
  SYNC_CODE_STORAGE_KEY,
  clearSyncCode,
  getSyncCode,
  hydrateSyncCodeSecure,
  setSyncCode,
} from "./sync-code"

const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => (mem.has(key) ? mem.get(key)! : null),
  setItem: (key: string, value: string) => void mem.set(key, value),
  removeItem: (key: string) => void mem.delete(key),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size
  },
} as Storage

test("sync-code: getter 不迁移旧公开同步码", () => {
  mem.clear()
  mem.set(SYNC_CODE_STORAGE_KEY, "legacy-sync-code")

  assert.equal(getSyncCode(), null)
  assert.equal(mem.get(SYNC_CODE_STORAGE_KEY), "legacy-sync-code")
  assert.equal(mem.get(secureFallbackStorageKey(SYNC_CODE_SECURE_KEY)), undefined)
})

test("sync-code: hydrate 显式迁移旧公开同步码到 secure-store fallback", async () => {
  mem.clear()
  mem.set(SYNC_CODE_STORAGE_KEY, "legacy-sync-code")

  assert.equal(await hydrateSyncCodeSecure(), "legacy-sync-code")
  assert.equal(mem.get(secureFallbackStorageKey(SYNC_CODE_SECURE_KEY)), "legacy-sync-code")
  assert.equal(mem.get(SYNC_CODE_STORAGE_KEY), undefined)
  assert.equal(getSyncCode(), "legacy-sync-code")
})

test("sync-code: 新写入只落 secure-store fallback", async () => {
  mem.clear()
  await setSyncCode("new-sync-code")

  assert.equal(getSyncCode(), "new-sync-code")
  assert.equal(mem.get(SYNC_CODE_STORAGE_KEY), undefined)
  assert.equal(mem.get(secureFallbackStorageKey(SYNC_CODE_SECURE_KEY)), "new-sync-code")

  await clearSyncCode()
  assert.equal(getSyncCode(), null)
  assert.equal(mem.get(secureFallbackStorageKey(SYNC_CODE_SECURE_KEY)), undefined)
})
