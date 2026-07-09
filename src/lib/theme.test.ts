import { test } from "node:test"
import assert from "node:assert/strict"
import { LEGACY_THEME_KEY, THEME_KEY, getThemeChoice } from "./theme"

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

test("theme: 旧主题键迁移到 ideall 命名空间并删除旧键", () => {
  mem.clear()
  mem.set(LEGACY_THEME_KEY, "dark")

  assert.equal(getThemeChoice(), "dark")
  assert.equal(mem.get(THEME_KEY), "dark")
  assert.equal(mem.get(LEGACY_THEME_KEY), undefined)
})

test("theme: 新旧主题键同时存在时 canonical 主题胜出", () => {
  mem.clear()
  mem.set(THEME_KEY, "light")
  mem.set(LEGACY_THEME_KEY, "dark")

  assert.equal(getThemeChoice(), "light")
  assert.equal(mem.get(THEME_KEY), "light")
  assert.equal(mem.get(LEGACY_THEME_KEY), undefined)
})
