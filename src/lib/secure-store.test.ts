import { test } from "node:test"
import assert from "node:assert/strict"
import {
  isSecureFallbackKey,
  secureDelete,
  secureFallbackStorageKey,
  secureGet,
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
