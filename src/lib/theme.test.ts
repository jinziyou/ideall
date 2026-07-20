import { test } from "node:test"
import assert from "node:assert/strict"
import { THEME_KEY, getThemeChoice, setThemeChoice, subscribeThemeChoice } from "./theme"

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

test("theme: 读取当前主题键", () => {
  mem.clear()
  mem.set(THEME_KEY, "dark")

  assert.equal(getThemeChoice(), "dark")
  assert.equal(mem.get(THEME_KEY), "dark")
})

test("theme: 非法主题回退 system", () => {
  mem.clear()
  mem.set(THEME_KEY, "sepia")

  assert.equal(getThemeChoice(), "system")
})

test("theme: 同进程 choice 改变即使没有 DOM class 变化也通知观察者", () => {
  mem.clear()
  const choices: string[] = []
  const dispose = subscribeThemeChoice(() => choices.push(getThemeChoice()))

  setThemeChoice("dark")
  setThemeChoice("system")
  dispose()
  setThemeChoice("light")

  assert.deepEqual(choices, ["dark", "system"])
})
