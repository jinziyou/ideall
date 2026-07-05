import { test } from "node:test"
import assert from "node:assert/strict"
import {
  AGENT_SETTINGS_STORAGE_KEY,
  agentSettingsSecuritySnapshot,
  getAgentSettings,
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

test("agent settings: Web 降级路径仍保存 API Key", () => {
  mem.clear()
  setAgentSettings({
    baseURL: "https://api.example.test/v1",
    model: "m",
    apiKey: "sk-test",
    includeHomeContext: false,
    approvalPolicy: "auto",
  })
  assert.equal(getAgentSettings().apiKey, "sk-test")
  assert.equal(JSON.parse(mem.get(AGENT_SETTINGS_STORAGE_KEY) ?? "{}").apiKey, "sk-test")
})

test("agentSettingsSecuritySnapshot: 能识别 localStorage 中的旧明文 key", () => {
  mem.clear()
  mem.set(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify({ apiKey: "legacy-key" }))
  assert.equal(agentSettingsSecuritySnapshot().localApiKeyPresent, true)
})
