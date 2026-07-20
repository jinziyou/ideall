import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ACP_SETTINGS_STORAGE_KEY,
  LEGACY_ACP_SETTINGS_STORAGE_KEY,
  DEFAULT_ACP_SETTINGS,
  getAcpSettings,
  parseAcpSettings,
} from "./acp-settings"

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
    executionBackend: "model",
  })
})

test("执行后端只接受已知值，旧设置默认使用模型", () => {
  assert.equal(
    parseAcpSettings(JSON.stringify({ executionBackend: "external-acp" })).executionBackend,
    "external-acp",
  )
  assert.equal(
    parseAcpSettings(JSON.stringify({ executionBackend: "shell" })).executionBackend,
    "model",
  )
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

test("ACP settings: 旧公开设置迁移到 ideall 命名空间并删除旧键", () => {
  mem.clear()
  const legacySettings = {
    allowEditorConnect: true,
    listenPort: 3210,
    externalAgent: { program: "npx", args: "acp --stdio", cwd: "/tmp/legacy" },
  }
  const normalized = { ...legacySettings, executionBackend: "model" }
  mem.set(LEGACY_ACP_SETTINGS_STORAGE_KEY, JSON.stringify(legacySettings))

  assert.deepEqual(getAcpSettings(), normalized)
  assert.equal(mem.get(ACP_SETTINGS_STORAGE_KEY), JSON.stringify(normalized))
  assert.equal(mem.get(LEGACY_ACP_SETTINGS_STORAGE_KEY), undefined)
})

test("ACP settings: 新旧公开设置同时存在时 canonical 设置胜出", () => {
  mem.clear()
  const canonicalSettings = {
    allowEditorConnect: false,
    listenPort: 9876,
    externalAgent: { program: "canonical-acp", args: "--serve", cwd: "/tmp/canonical" },
    executionBackend: "external-acp" as const,
  }
  const legacySettings = {
    allowEditorConnect: true,
    listenPort: 1111,
    externalAgent: { program: "legacy-acp", args: "--stdio", cwd: "/tmp/legacy" },
  }
  mem.set(ACP_SETTINGS_STORAGE_KEY, JSON.stringify(canonicalSettings))
  mem.set(LEGACY_ACP_SETTINGS_STORAGE_KEY, JSON.stringify(legacySettings))

  assert.deepEqual(getAcpSettings(), canonicalSettings)
  assert.equal(mem.get(LEGACY_ACP_SETTINGS_STORAGE_KEY), undefined)
})
