import { test } from "node:test"
import assert from "node:assert/strict"
import { secureFallbackStorageKey } from "@/lib/secure-store"
import {
  AUTH_TOKEN_SECURE_KEY,
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  LEGACY_AUTH_USER_STORAGE_KEY,
  clearSession,
  getSession,
  hydrateSessionTokenSecure,
  setSession,
} from "./auth-store"

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

const user = {
  id: `u:${"1".repeat(32)}`,
  email: "u@example.test",
  name: "User",
  avatar: null,
}

test("auth-store: getter 不迁移旧公开 token", () => {
  mem.clear()
  mem.set(AUTH_TOKEN_STORAGE_KEY, "legacy-token")
  mem.set(AUTH_USER_STORAGE_KEY, JSON.stringify(user))

  assert.equal(getSession(), null)
  assert.equal(mem.get(AUTH_TOKEN_STORAGE_KEY), "legacy-token")
  assert.equal(mem.get(secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY)), undefined)
})

test("auth-store: hydrate 显式迁移旧公开 token 到 secure-store fallback", async () => {
  mem.clear()
  mem.set(AUTH_TOKEN_STORAGE_KEY, "legacy-token")
  mem.set(AUTH_USER_STORAGE_KEY, JSON.stringify(user))

  assert.equal(await hydrateSessionTokenSecure(), "legacy-token")
  assert.equal(mem.get(secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY)), "legacy-token")
  assert.equal(mem.get(AUTH_TOKEN_STORAGE_KEY), undefined)
  assert.deepEqual(getSession(), { token: "legacy-token", user })
})

test("auth-store: 旧用户资料迁移到 ideall 命名空间并删除旧键", () => {
  mem.clear()
  const token = "token-user-migration"
  mem.set(secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY), token)
  mem.set(LEGACY_AUTH_USER_STORAGE_KEY, JSON.stringify(user))

  assert.deepEqual(getSession(), { token, user })
  assert.equal(mem.get(AUTH_USER_STORAGE_KEY), JSON.stringify(user))
  assert.equal(mem.get(LEGACY_AUTH_USER_STORAGE_KEY), undefined)
})

test("auth-store: V1 数字用户 ID 缓存不再恢复为 V2 会话", () => {
  mem.clear()
  mem.set(secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY), "legacy-v1-token")
  mem.set(
    AUTH_USER_STORAGE_KEY,
    JSON.stringify({ id: 1, email: "legacy@example.test", name: "Legacy", avatar: null }),
  )
  assert.equal(getSession(), null)
})

test("auth-store: 新旧用户资料同时存在时 canonical 用户资料胜出", () => {
  mem.clear()
  const token = "token-canonical-user"
  const canonicalUser = { ...user, email: "canonical@example.test", name: "Canonical" }
  const legacyUser = { ...user, email: "legacy@example.test", name: "Legacy" }
  mem.set(secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY), token)
  mem.set(AUTH_USER_STORAGE_KEY, JSON.stringify(canonicalUser))
  mem.set(LEGACY_AUTH_USER_STORAGE_KEY, JSON.stringify(legacyUser))

  assert.deepEqual(getSession(), { token, user: canonicalUser })
  assert.equal(JSON.parse(mem.get(AUTH_USER_STORAGE_KEY) ?? "{}").email, canonicalUser.email)
  assert.equal(mem.get(LEGACY_AUTH_USER_STORAGE_KEY), undefined)
})

test("auth-store: 新登录只把 token 写入 secure-store fallback", async () => {
  mem.clear()
  await setSession("new-token", user)

  assert.deepEqual(getSession(), { token: "new-token", user })
  assert.equal(mem.get(AUTH_TOKEN_STORAGE_KEY), undefined)
  assert.equal(mem.get(secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY)), "new-token")
  assert.equal(JSON.parse(mem.get(AUTH_USER_STORAGE_KEY) ?? "{}").email, user.email)

  await clearSession()
  assert.equal(getSession(), null)
  assert.equal(mem.get(secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY)), undefined)
  assert.equal(mem.get(AUTH_USER_STORAGE_KEY), undefined)
})
