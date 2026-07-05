import { test } from "node:test"
import assert from "node:assert/strict"
import { redactValue, safeStoragePreview } from "./code-redact"

test("safeStoragePreview: 敏感 key 整体脱敏", () => {
  const cases = [
    "authToken",
    "api_key",
    "session-cookie",
    "refreshToken",
    "password",
    "wonita:sync:code",
  ]
  for (const key of cases) {
    const preview = safeStoragePreview(key, "super-secret")
    assert.equal(preview.redacted, true, key)
    assert.ok(!preview.value.includes("super-secret"), key)
  }
})

test("safeStoragePreview: JSON 内嵌敏感字段递归脱敏", () => {
  const raw = JSON.stringify({
    user: "alice",
    nested: {
      apiKey: "sk-live",
      items: [{ cookie: "sid=1" }, { visible: "ok" }],
    },
  })
  const preview = safeStoragePreview("normal-storage", raw)
  assert.equal(preview.redacted, true)
  assert.ok(preview.value.includes("alice"))
  assert.ok(preview.value.includes("visible"))
  assert.ok(!preview.value.includes("sk-live"))
  assert.ok(!preview.value.includes("sid=1"))
})

test("safeStoragePreview: 非敏感普通文本只截断不脱敏", () => {
  const value = "x".repeat(200)
  const preview = safeStoragePreview("layout", value)
  assert.equal(preview.redacted, false)
  assert.equal(preview.value.length, 163)
  assert.ok(preview.value.endsWith("..."))
})

test("redactValue: 保留非敏感结构, 只替换敏感字段值", () => {
  assert.deepEqual(redactValue({ token: "abc", nested: [{ name: "n" }] }), {
    token: "••••••",
    nested: [{ name: "n" }],
  })
})
