import { test } from "node:test"
import assert from "node:assert/strict"
import {
  LEGACY_PUBLIC_STORAGE_KEYS,
  SECURE_STORE_KEYS,
  SecureStoreUnavailableError,
  isSecureFallbackKey,
  listSecureStoreKnownItems,
  migrateLegacySecureValues,
  publicStorageGet,
  publicStorageGetWithLegacy,
  registerSecureStoreDynamicItems,
  secureDelete,
  secureFallbackStorageKey,
  secureGet,
  secureGetWithLegacy,
  secureStoreSecuritySnapshot,
  secureSet,
  secureStoreStatus,
} from "./secure-store"

const mem = new Map<string, string>()
const localStorageStub: Storage = {
  getItem: (key: string) => (mem.has(key) ? mem.get(key)! : null),
  setItem: (key: string, value: string) => void mem.set(key, value),
  removeItem: (key: string) => void mem.delete(key),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size
  },
}
Object.defineProperty(globalThis, "localStorage", { value: localStorageStub, configurable: true })

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

test("secure-store: App 凭据库故障时 fail closed 且不读写明文 fallback", async () => {
  mem.clear()
  ;(globalThis as unknown as { window?: Window }).window = {
    __TAURI_INTERNALS__: {},
  } as unknown as Window
  const key = "ideall:test:desktop"
  const fallback = secureFallbackStorageKey(key)
  mem.set(fallback, "old-plaintext-secret")

  try {
    const status = await secureStoreStatus()
    assert.equal(status.backend, "unavailable")
    assert.equal(status.native, false)
    assert.equal(await secureGet(key), null)
    await assert.rejects(
      secureSet(key, "new-secret"),
      (error) => error instanceof SecureStoreUnavailableError,
    )
    assert.equal(mem.get(fallback), "old-plaintext-secret")
    await assert.rejects(secureDelete(key), (error) => error instanceof SecureStoreUnavailableError)
    assert.equal(mem.get(fallback), "old-plaintext-secret")
  } finally {
    delete (globalThis as unknown as { window?: Window }).window
  }
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

test("secure-store: 公开键 helper 把旧键迁移到 canonical 键", () => {
  mem.clear()
  mem.set("wonita:public:test", "legacy-public")

  assert.equal(
    publicStorageGetWithLegacy("ideall:public:test", "wonita:public:test"),
    "legacy-public",
  )
  assert.equal(mem.get("ideall:public:test"), "legacy-public")
  assert.equal(publicStorageGet("wonita:public:test"), null)
})

test("secure-store: 公开键 helper 在新旧键并存时 canonical 胜出", () => {
  mem.clear()
  mem.set("ideall:public:test", "canonical-public")
  mem.set("wonita:public:test", "legacy-public")

  assert.equal(
    publicStorageGetWithLegacy("ideall:public:test", "wonita:public:test"),
    "canonical-public",
  )
  assert.equal(mem.get("ideall:public:test"), "canonical-public")
  assert.equal(publicStorageGet("wonita:public:test"), null)
})

test("secure-store: secure fallback 存在时旧公开 token 不覆盖 canonical token", async () => {
  mem.clear()
  await secureSet(SECURE_STORE_KEYS.AUTH_TOKEN, "canonical-token")
  mem.set(LEGACY_PUBLIC_STORAGE_KEYS.AUTH_TOKEN, "legacy-token")

  assert.equal(
    await secureGetWithLegacy(SECURE_STORE_KEYS.AUTH_TOKEN, LEGACY_PUBLIC_STORAGE_KEYS.AUTH_TOKEN),
    "canonical-token",
  )
  assert.equal(mem.get(secureFallbackStorageKey(SECURE_STORE_KEYS.AUTH_TOKEN)), "canonical-token")
  assert.equal(publicStorageGet(LEGACY_PUBLIC_STORAGE_KEYS.AUTH_TOKEN), null)
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

test("secure-store: App 验证写入后迁移遗留明文且不覆盖原生真值", async () => {
  mem.clear()
  mem.set(secureFallbackStorageKey(SECURE_STORE_KEYS.AUTH_TOKEN), "fallback-token")
  mem.set(LEGACY_PUBLIC_STORAGE_KEYS.SYNC_CODE, "legacy-sync")
  const native = new Map<string, string>([[SECURE_STORE_KEYS.AUTH_TOKEN, "native-token"]])
  const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const key = String(args?.key)
    if (command === "secure_store_get") return (native.get(key) ?? null) as T
    if (command === "secure_store_set") {
      native.set(key, String(args?.value))
      return undefined as T
    }
    throw new Error("unexpected command")
  }

  const result = await migrateLegacySecureValues({ native: true, invoke })

  assert.deepEqual(result, {
    available: true,
    migrated: 1,
    removedPlaintext: 2,
    failed: 0,
    remaining: 0,
  })
  assert.equal(native.get(SECURE_STORE_KEYS.AUTH_TOKEN), "native-token")
  assert.equal(native.get(SECURE_STORE_KEYS.SYNC_CODE), "legacy-sync")
  assert.equal(mem.size, 0)
})

test("secure-store: 迁移读回失败时保留明文来源供重试", async () => {
  mem.clear()
  mem.set(secureFallbackStorageKey(SECURE_STORE_KEYS.SYNC_CODE), "keep-me")
  const result = await migrateLegacySecureValues({
    native: true,
    invoke: async <T>(command: string): Promise<T> => {
      if (command === "secure_store_get") return null as T
      return undefined as T
    },
  })

  assert.equal(result.failed, 1)
  assert.equal(result.remaining, 1)
  assert.equal(mem.get(secureFallbackStorageKey(SECURE_STORE_KEYS.SYNC_CODE)), "keep-me")
})

test("secure-store: 动态登记项进入安全快照并按 key 去重", () => {
  mem.clear()
  mem.set(secureFallbackStorageKey("ideall:agent:secret:TOK"), "fallback-secret")
  const dispose = registerSecureStoreDynamicItems(() => [
    {
      id: "agent.secret.TOK",
      label: "MCP 密钥 TOK",
      owner: "agent",
      key: "ideall:agent:secret:TOK",
    },
    { id: "agent.secret.DUP", label: "重复键", owner: "agent", key: SECURE_STORE_KEYS.AUTH_TOKEN },
  ])
  try {
    const snapshot = secureStoreSecuritySnapshot()
    const dynamic = snapshot.items.find((item) => item.key === "ideall:agent:secret:TOK")
    assert.ok(dynamic)
    assert.equal(dynamic.fallbackPresent, true)
    // 与静态项同 key 的动态项被去重，不重复计数。
    assert.equal(
      snapshot.items.filter((item) => item.key === SECURE_STORE_KEYS.AUTH_TOKEN).length,
      1,
    )
    assert.equal(snapshot.fallbackValueCount, 1)
    assert.ok(listSecureStoreKnownItems().some((item) => item.key === "ideall:agent:secret:TOK"))
  } finally {
    dispose()
  }
  assert.equal(
    listSecureStoreKnownItems().some((item) => item.key === "ideall:agent:secret:TOK"),
    false,
    "注销后动态项撤出快照",
  )
})

test("secure-store: 动态登记项的 fallback 明文一并迁移", async () => {
  mem.clear()
  mem.set(secureFallbackStorageKey("ideall:agent:oauth:server-a:tokens"), "legacy-oauth")
  const native = new Map<string, string>()
  const dispose = registerSecureStoreDynamicItems(() => [
    {
      id: "agent.oauth.server-a.tokens",
      label: "MCP OAuth 令牌",
      owner: "agent",
      key: "ideall:agent:oauth:server-a:tokens",
    },
  ])
  try {
    const result = await migrateLegacySecureValues({
      native: true,
      invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
        const key = String(args?.key)
        if (command === "secure_store_get") return (native.get(key) ?? null) as T
        if (command === "secure_store_set") {
          native.set(key, String(args?.value))
          return undefined as T
        }
        throw new Error("unexpected command")
      },
    })
    assert.deepEqual(result, {
      available: true,
      migrated: 1,
      removedPlaintext: 1,
      failed: 0,
      remaining: 0,
    })
    assert.equal(native.get("ideall:agent:oauth:server-a:tokens"), "legacy-oauth")
    assert.equal(mem.size, 0)
  } finally {
    dispose()
  }
})

test("secure-store: 迁移与并发 secureSet 互斥（同一叶子锁，后写胜出）", async () => {
  mem.clear()
  mem.set(secureFallbackStorageKey("ideall:agent:oauth:server-a:tokens"), "legacy-oauth")
  const dispose = registerSecureStoreDynamicItems(() => [
    {
      id: "agent.oauth.server-a.tokens",
      label: "MCP OAuth 令牌",
      owner: "agent",
      key: "ideall:agent:oauth:server-a:tokens",
    },
  ])
  const native = new Map<string, string>()
  let releaseSlowGet: (() => void) | null = null
  try {
    const migration = migrateLegacySecureValues({
      native: true,
      invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
        const key = String(args?.key)
        if (command === "secure_store_get") {
          if (native.has(key)) return native.get(key) as T
          await new Promise<void>((resolve) => {
            releaseSlowGet = resolve
          })
          return null as T
        }
        if (command === "secure_store_set") {
          native.set(key, String(args?.value))
          return undefined as T
        }
        throw new Error("unexpected command")
      },
    })
    let setResolved = false
    const concurrentSet = secureSet("ideall:agent:oauth:server-a:tokens", "new-rotated").then(
      (backend) => {
        setResolved = true
        return backend
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(setResolved, false, "迁移持锁期间并发写必须等待")
    releaseSlowGet!()
    await migration
    await concurrentSet
    assert.equal(setResolved, true)
    // 互斥后的确定性结果：迁移先完成（迁走旧 fallback），并发写后落地且不被旧值覆盖。
    assert.equal(
      mem.get(secureFallbackStorageKey("ideall:agent:oauth:server-a:tokens")),
      "new-rotated",
    )
    assert.equal(native.get("ideall:agent:oauth:server-a:tokens"), "legacy-oauth")
  } finally {
    dispose()
  }
})
