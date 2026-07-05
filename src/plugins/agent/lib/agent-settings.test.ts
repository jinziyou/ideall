import { test } from "node:test"
import assert from "node:assert/strict"
import { SECURE_STORE_KEYS, secureFallbackStorageKey } from "@/lib/secure-store"
import {
  AGENT_SETTINGS_STORAGE_KEY,
  agentSettingsSecuritySnapshot,
  getAgentSettings,
  hydrateAgentSettingsSecure,
  setAgentSettings,
} from "./agent-settings"

const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => (mem.has(key) ? mem.get(key)! : null),
  setItem: (key: string, value: string) => void mem.set(key, value),
  removeItem: (key: string) => void mem.delete(key),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage

test("agent settings: 桌面安全水合不再接受 localStorage 明文 API Key", async () => {
  mem.clear()
  ;(globalThis as unknown as { window?: Window }).window = {
    __TAURI_INTERNALS__: {},
  } as unknown as Window
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
  delete (globalThis as unknown as { window?: Window }).window
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
