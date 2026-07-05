import { test } from "node:test"
import assert from "node:assert/strict"
import { secureFallbackStorageKey } from "@/lib/secure-store"
import {
  AUTH_TOKEN_SECURE_KEY,
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  clearSession,
  getSession,
  hydrateSessionTokenSecure,
  setSession,
} from "./auth-store"

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

const user = { id: 1, email: "u@example.test", name: "User", avatar: null }

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

test("auth-store: 新登录只把 token 写入 secure-store fallback", () => {
  mem.clear()
  setSession("new-token", user)

  assert.deepEqual(getSession(), { token: "new-token", user })
  assert.equal(mem.get(AUTH_TOKEN_STORAGE_KEY), undefined)
  assert.equal(mem.get(secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY)), "new-token")
  assert.equal(JSON.parse(mem.get(AUTH_USER_STORAGE_KEY) ?? "{}").email, user.email)

  clearSession()
  assert.equal(getSession(), null)
  assert.equal(mem.get(secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY)), undefined)
  assert.equal(mem.get(AUTH_USER_STORAGE_KEY), undefined)
})
