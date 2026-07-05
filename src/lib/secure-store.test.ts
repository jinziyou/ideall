import { test } from "node:test"
import assert from "node:assert/strict"
import {
  LEGACY_PUBLIC_STORAGE_KEYS,
  SECURE_STORE_KEYS,
  isSecureFallbackKey,
  publicStorageGet,
  secureDelete,
  secureFallbackStorageKey,
  secureGet,
  secureGetWithLegacy,
  secureStoreSecuritySnapshot,
  secureSet,
  secureStoreStatus,
} from "./secure-store"

const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => (mem.has(key) ? mem.get(key)! : null),
  setItem: (key: string, value: string) => void mem.set(key, value),
  removeItem: (key: string) => void mem.delete(key),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage

test("secure-store: Web 形态使用命名 fallback key", async () => {
  mem.clear()
  assert.deepEqual(await secureStoreStatus(), { backend: "web-localStorage", native: false })
  assert.equal(await secureSet("ideall:test", "secret"), "web-localStorage")
  assert.equal(mem.get(secureFallbackStorageKey("ideall:test")), "secret")
  assert.equal(isSecureFallbackKey(secureFallbackStorageKey("ideall:test")), true)
  assert.equal(await secureGet("ideall:test"), "secret")
  await secureDelete("ideall:test")
  assert.equal(await secureGet("ideall:test"), null)
})

test("secure-store: 旧公开键可迁移到统一 fallback key", async () => {
  mem.clear()
  mem.set(LEGACY_PUBLIC_STORAGE_KEYS.SYNC_CODE, "sync-secret")

  assert.equal(
    await secureGetWithLegacy(SECURE_STORE_KEYS.SYNC_CODE, LEGACY_PUBLIC_STORAGE_KEYS.SYNC_CODE),
    "sync-secret",
  )
  assert.equal(mem.get(secureFallbackStorageKey(SECURE_STORE_KEYS.SYNC_CODE)), "sync-secret")
  assert.equal(publicStorageGet(LEGACY_PUBLIC_STORAGE_KEYS.SYNC_CODE), null)
})

test("secure-store: 安全快照识别 fallback 与旧公开键", async () => {
  mem.clear()
  await secureSet(SECURE_STORE_KEYS.AUTH_TOKEN, "token")
  mem.set(LEGACY_PUBLIC_STORAGE_KEYS.SYNC_CODE, "sync-secret")

  const snapshot = secureStoreSecuritySnapshot()
  assert.equal(snapshot.registeredCount >= 3, true)
  assert.equal(snapshot.fallbackValueCount, 1)
  assert.equal(snapshot.legacyValueCount, 1)
  assert.equal(snapshot.items.find((item) => item.id === "auth.token")?.fallbackPresent, true)
  assert.equal(snapshot.items.find((item) => item.id === "sync.code")?.legacyPresent, true)
})
