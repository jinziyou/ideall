import { test } from "node:test"
import assert from "node:assert/strict"
import { SECURE_STORE_KEYS, secureFallbackStorageKey } from "@/lib/secure-store"
import {
  AGENT_SETTINGS_STORAGE_KEY,
  LEGACY_AGENT_SETTINGS_STORAGE_KEY,
  agentSettingsSecuritySnapshot,
  getAgentSettings,
  hydrateAgentSettingsSecure,
  setAgentSettings,
} from "./agent-settings"

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

test("agent settings: 桌面安全水合不再接受 localStorage 明文 API Key", async () => {
  mem.clear()
  Object.defineProperty(globalThis, "window", {
    value: { __TAURI_INTERNALS__: {} },
    configurable: true,
  })
  mem.set(
    AGENT_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      baseURL: "https://api.example.test/v1",
      model: "m",
      apiKey: "sk-public",
    }),
  )

  const settings = await hydrateAgentSettingsSecure()
  const publicSettings = JSON.parse(mem.get(AGENT_SETTINGS_STORAGE_KEY) ?? "{}")

  assert.equal(settings.apiKey, "")
  assert.equal(publicSettings.apiKey, undefined)
  assert.equal(publicSettings.model, "m")
  Reflect.deleteProperty(globalThis, "window")
})

test("agent settings: 旧公开设置迁移到 ideall 命名空间并删除旧键", async () => {
  mem.clear()
  const legacySettings = {
    baseURL: "https://legacy.example.test/v1",
    model: "legacy-model",
    includeHomeContext: false,
    defaultAgentMode: false,
    approvalPolicy: "auto",
  }
  mem.set(LEGACY_AGENT_SETTINGS_STORAGE_KEY, JSON.stringify(legacySettings))

  const settings = await hydrateAgentSettingsSecure()
  const persisted = JSON.parse(mem.get(AGENT_SETTINGS_STORAGE_KEY) ?? "{}")

  assert.equal(settings.baseURL, legacySettings.baseURL)
  assert.equal(settings.model, legacySettings.model)
  assert.equal(settings.includeHomeContext, false)
  assert.equal(settings.defaultAgentMode, false)
  assert.equal(settings.approvalPolicy, "auto")
  assert.equal(persisted.baseURL, legacySettings.baseURL)
  assert.equal(mem.get(LEGACY_AGENT_SETTINGS_STORAGE_KEY), undefined)
})

test("agent settings: 新旧公开设置同时存在时 canonical 设置胜出", () => {
  mem.clear()
  const canonicalSettings = {
    baseURL: "https://canonical.example.test/v1",
    model: "canonical-model",
    includeHomeContext: true,
    defaultAgentMode: false,
    approvalPolicy: "confirm",
  }
  const legacySettings = {
    baseURL: "https://legacy.example.test/v1",
    model: "legacy-model",
    includeHomeContext: false,
    defaultAgentMode: true,
    approvalPolicy: "auto",
  }
  mem.set(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify(canonicalSettings))
  mem.set(LEGACY_AGENT_SETTINGS_STORAGE_KEY, JSON.stringify(legacySettings))

  const settings = getAgentSettings()

  assert.equal(settings.baseURL, canonicalSettings.baseURL)
  assert.equal(settings.model, canonicalSettings.model)
  assert.equal(settings.includeHomeContext, true)
  assert.equal(settings.defaultAgentMode, false)
  assert.equal(settings.approvalPolicy, "confirm")
  assert.equal(mem.get(LEGACY_AGENT_SETTINGS_STORAGE_KEY), undefined)
})

test("agent settings: Web 降级路径把 API Key 写入 secure-store fallback", () => {
  mem.clear()
  setAgentSettings({
    baseURL: "https://api.example.test/v1",
    model: "m",
    apiKey: "sk-test",
    includeHomeContext: false,
    defaultAgentMode: true,
    approvalPolicy: "auto",
  })
  assert.equal(getAgentSettings().apiKey, "sk-test")
  assert.equal(JSON.parse(mem.get(AGENT_SETTINGS_STORAGE_KEY) ?? "{}").apiKey, undefined)
  assert.equal(
    mem.get(secureFallbackStorageKey(SECURE_STORE_KEYS.AGENT_SETTINGS_API_KEY)),
    "sk-test",
  )
})

test("agentSettingsSecuritySnapshot: 能识别 localStorage 中的旧明文 key", () => {
  mem.clear()
  mem.set(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify({ apiKey: "legacy-key" }))
  assert.equal(agentSettingsSecuritySnapshot().localApiKeyPresent, true)
})
