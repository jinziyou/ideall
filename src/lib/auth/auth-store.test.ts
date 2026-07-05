import { test } from "node:test"
import assert from "node:assert/strict"
import { secureFallbackStorageKey } from "@/lib/secure-store"
import {
  AUTH_TOKEN_SECURE_KEY,
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  clearSession,
  getSession,
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

test("auth-store: 旧公开 token 自动迁移到 secure-store fallback", () => {
  mem.clear()
  mem.set(AUTH_TOKEN_STORAGE_KEY, "legacy-token")
  mem.set(AUTH_USER_STORAGE_KEY, JSON.stringify(user))

  assert.deepEqual(getSession(), { token: "legacy-token", user })
  assert.equal(mem.get(AUTH_TOKEN_STORAGE_KEY), undefined)
  assert.equal(mem.get(secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY)), "legacy-token")
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
