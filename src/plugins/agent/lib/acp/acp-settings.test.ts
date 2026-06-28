import { test } from "node:test"
import assert from "node:assert/strict"
import { parseAcpSettings, DEFAULT_ACP_SETTINGS } from "./acp-settings"

test("null / 空串 → 默认", () => {
  assert.deepEqual(parseAcpSettings(null), DEFAULT_ACP_SETTINGS)
  assert.deepEqual(parseAcpSettings(""), DEFAULT_ACP_SETTINGS)
})

test("非法 JSON → 默认", () => {
  assert.deepEqual(parseAcpSettings("{not json"), DEFAULT_ACP_SETTINGS)
})

test("部分字段与默认合并", () => {
  assert.deepEqual(parseAcpSettings(JSON.stringify({ allowEditorConnect: true })), {
    allowEditorConnect: true,
    listenPort: 0,
    externalAgent: { program: "", args: "", cwd: "" },
  })
})

test("externalAgent 字段强制字符串并与默认合并", () => {
  const r = parseAcpSettings(
    JSON.stringify({ externalAgent: { program: "npx", args: "tsx a.ts" } }),
  )
  assert.deepEqual(r.externalAgent, { program: "npx", args: "tsx a.ts", cwd: "" })
  // 非字符串字段回退空串
  const bad = parseAcpSettings(JSON.stringify({ externalAgent: { program: 123 } }))
  assert.equal(bad.externalAgent.program, "")
})

test("越界端口回退默认; 合法端口保留", () => {
  assert.equal(parseAcpSettings(JSON.stringify({ listenPort: 70000 })).listenPort, 0)
  assert.equal(parseAcpSettings(JSON.stringify({ listenPort: -1 })).listenPort, 0)
  assert.equal(parseAcpSettings(JSON.stringify({ listenPort: 9876 })).listenPort, 9876)
})

test("allowEditorConnect 强制布尔", () => {
  assert.equal(parseAcpSettings(JSON.stringify({ allowEditorConnect: 1 })).allowEditorConnect, true)
  assert.equal(
    parseAcpSettings(JSON.stringify({ allowEditorConnect: 0 })).allowEditorConnect,
    false,
  )
})
