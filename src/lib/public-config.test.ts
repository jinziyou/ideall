import assert from "node:assert/strict"
import { test } from "node:test"
import { readPublicConfig, removePublicConfig, writePublicConfig } from "./public-config"

test("public config: preserves keys and reports unavailable writes without throwing", () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
  assert.equal(writePublicConfig("ideall:test", "value", storage), true)
  assert.equal(readPublicConfig("ideall:test", storage), "value")
  assert.equal(removePublicConfig("ideall:test", storage), true)
  assert.equal(readPublicConfig("ideall:test", storage), null)

  const unavailable = {
    getItem: () => {
      throw new Error("unavailable")
    },
    setItem: () => {
      throw new Error("unavailable")
    },
    removeItem: () => {
      throw new Error("unavailable")
    },
  }
  assert.equal(readPublicConfig("ideall:test", unavailable), null)
  assert.equal(writePublicConfig("ideall:test", "value", unavailable), false)
  assert.equal(removePublicConfig("ideall:test", unavailable), false)
})
