import assert from "node:assert/strict"
import { test } from "node:test"

import {
  LEGACY_PUBLIC_STORAGE_KEYS,
  SECURE_STORE_KEYS,
  SecureStoreUnavailableError,
  isSecureFallbackKey,
  listSecureStoreKnownItems,
  registerSecureStoreDynamicItems,
  secureDelete,
  secureFallbackStorageKey,
  secureGet,
  secureSet,
  secureStoreSecuritySnapshot,
  secureStoreStatus,
} from "./secure-store"

const memory = new Map<string, string>()
const localStorageStub: Storage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
  clear: () => memory.clear(),
  key: (index) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size
  },
}
Object.defineProperty(globalThis, "localStorage", { value: localStorageStub, configurable: true })

test("secure-store: Web uses the namespaced fallback", async () => {
  memory.clear()
  assert.deepEqual(await secureStoreStatus(), { backend: "web-localStorage", native: false })
  assert.equal(await secureSet("ideall:test", "secret"), "web-localStorage")
  assert.equal(memory.get(secureFallbackStorageKey("ideall:test")), "secret")
  assert.equal(isSecureFallbackKey(secureFallbackStorageKey("ideall:test")), true)
  assert.equal(await secureGet("ideall:test"), "secret")
  await secureDelete("ideall:test")
  assert.equal(await secureGet("ideall:test"), null)
})

test("secure-store: desktop backend failures remain fail closed", async () => {
  memory.clear()
  ;(globalThis as unknown as { window?: Window }).window = {
    __TAURI_INTERNALS__: {},
  } as unknown as Window
  const key = "ideall:test:desktop"
  const fallback = secureFallbackStorageKey(key)
  memory.set(fallback, "old-plaintext-secret")

  try {
    const status = await secureStoreStatus()
    assert.equal(status.backend, "unavailable")
    assert.equal(await secureGet(key), null)
    await assert.rejects(secureSet(key, "new-secret"), SecureStoreUnavailableError)
    await assert.rejects(secureDelete(key), SecureStoreUnavailableError)
    assert.equal(memory.get(fallback), "old-plaintext-secret")
  } finally {
    delete (globalThis as unknown as { window?: Window }).window
  }
})

test("secure-store: security snapshot detects current fallback and obsolete public values", async () => {
  memory.clear()
  await secureSet(SECURE_STORE_KEYS.AUTH_TOKEN, "token")
  memory.set(LEGACY_PUBLIC_STORAGE_KEYS.SYNC_CODE, "obsolete")

  const snapshot = secureStoreSecuritySnapshot()
  assert.equal(snapshot.fallbackValueCount, 1)
  assert.equal(snapshot.legacyValueCount, 1)
  assert.equal(snapshot.items.find((item) => item.id === "auth.token")?.fallbackPresent, true)
  assert.equal(snapshot.items.find((item) => item.id === "sync.code")?.legacyPresent, true)
})

test("secure-store: dynamic keys participate in security snapshots and deregister cleanly", () => {
  memory.clear()
  const key = "ideall:agent:secret:TOK"
  memory.set(secureFallbackStorageKey(key), "fallback-secret")
  const dispose = registerSecureStoreDynamicItems(() => [
    { id: "agent.secret.TOK", label: "MCP 密钥 TOK", owner: "agent", key },
    { id: "agent.secret.DUP", label: "重复键", owner: "agent", key: SECURE_STORE_KEYS.AUTH_TOKEN },
  ])

  try {
    const snapshot = secureStoreSecuritySnapshot()
    assert.equal(snapshot.items.find((item) => item.key === key)?.fallbackPresent, true)
    assert.equal(
      snapshot.items.filter((item) => item.key === SECURE_STORE_KEYS.AUTH_TOKEN).length,
      1,
    )
  } finally {
    dispose()
  }
  assert.equal(
    listSecureStoreKnownItems().some((item) => item.key === key),
    false,
  )
})
