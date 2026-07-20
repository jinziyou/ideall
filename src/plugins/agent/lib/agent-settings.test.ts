import { test } from "node:test"
import assert from "node:assert/strict"
import { SECURE_STORE_KEYS, secureFallbackStorageKey } from "@/lib/secure-store"
import {
  AGENT_SETTINGS_CREDENTIAL_REVISION_STORAGE_KEY,
  AGENT_SETTINGS_STORAGE_KEY,
  agentSettingsCredentialRevisionSnapshot,
  agentSettingsSecuritySnapshot,
  clearAgentSettingsApiKey,
  getAgentSettings,
  hydrateAgentSettingsSecure,
  isAgentSettingsCredentialConfigured,
  setAgentSettingsApiKey,
  setAgentSettings,
  subscribeAgentSettings,
} from "./agent-settings"
import { writeAgentPublicConfigFileSection, writeAgentPublicConfigSection } from "./agent-data-port"

const mem = new Map<string, string>()
let removeFailure: Error | null = null
const localStorageStub: Storage = {
  getItem: (key: string) => (mem.has(key) ? mem.get(key)! : null),
  setItem: (key: string, value: string) => void mem.set(key, value),
  removeItem: (key: string) => {
    if (removeFailure) throw removeFailure
    mem.delete(key)
  },
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

test("agent settings: Web 降级路径把 API Key 写入 secure-store fallback", async () => {
  mem.clear()
  await setAgentSettings({
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

test("public settings write: baseURL 脱敏且 API Key 只在同 endpoint 保留", async () => {
  mem.clear()
  await setAgentSettings({
    baseURL: "https://api.example.test/v1",
    model: "m",
    apiKey: "same-origin-key",
    includeHomeContext: true,
    defaultAgentMode: true,
    approvalPolicy: "confirm",
  })

  await writeAgentPublicConfigSection("settings", {
    baseURL: "https://user:pass@api.example.test/v1?key=query-secret#fragment-secret",
    model: "m2",
    includeHomeContext: false,
    defaultAgentMode: false,
    approvalPolicy: "auto",
  })
  assert.equal(getAgentSettings().baseURL, "https://api.example.test/v1")
  assert.equal(getAgentSettings().apiKey, "same-origin-key")

  await writeAgentPublicConfigSection("settings", {
    baseURL: "https://api.example.test/v2",
    model: "m2",
    includeHomeContext: false,
    defaultAgentMode: false,
    approvalPolicy: "auto",
  })
  assert.equal(getAgentSettings().apiKey, "")
  assert.equal(
    mem.get(secureFallbackStorageKey(SECURE_STORE_KEYS.AGENT_SETTINGS_API_KEY)),
    undefined,
  )
})

test("agent settings credential actions: await secure persistence before publishing status", async () => {
  mem.clear()
  const snapshots: boolean[] = []
  const unsubscribe = subscribeAgentSettings(() => {
    snapshots.push(isAgentSettingsCredentialConfigured())
  })
  const unsubscribeBroken = subscribeAgentSettings(() => {
    throw new Error("listener failure")
  })

  await setAgentSettingsApiKey("sk-action-test")
  assert.equal(isAgentSettingsCredentialConfigured(), true)
  assert.equal(
    mem.get(secureFallbackStorageKey(SECURE_STORE_KEYS.AGENT_SETTINGS_API_KEY)),
    "sk-action-test",
  )

  await clearAgentSettingsApiKey()
  assert.equal(isAgentSettingsCredentialConfigured(), false)
  assert.equal(
    mem.get(secureFallbackStorageKey(SECURE_STORE_KEYS.AGENT_SETTINGS_API_KEY)),
    undefined,
  )
  assert.deepEqual(snapshots.slice(-2), [true, false])
  unsubscribeBroken()
  unsubscribe()
})

test("agent settings credential revision: persists monotonically without storing key material", async () => {
  mem.clear()

  await setAgentSettingsApiKey("sk-revision-A")
  const first = agentSettingsCredentialRevisionSnapshot()
  await setAgentSettingsApiKey("sk-revision-B")
  const second = agentSettingsCredentialRevisionSnapshot()
  await clearAgentSettingsApiKey()
  const third = agentSettingsCredentialRevisionSnapshot()

  assert.ok(BigInt(second) > BigInt(first))
  assert.ok(BigInt(third) > BigInt(second))
  assert.equal(mem.get(AGENT_SETTINGS_CREDENTIAL_REVISION_STORAGE_KEY), third)
  assert.equal(first.includes("sk-revision-A"), false)
  assert.equal(second.includes("sk-revision-B"), false)
  assert.equal(mem.get(AGENT_SETTINGS_CREDENTIAL_REVISION_STORAGE_KEY)?.includes("sk-"), false)
})

test("agent settings FileSystem write: endpoint changes clear credentials before public commit", async () => {
  mem.clear()
  await setAgentSettings({
    baseURL: "https://old.example.test/v1",
    model: "old-model",
    apiKey: "",
    includeHomeContext: true,
    defaultAgentMode: true,
    approvalPolicy: "confirm",
  })
  await setAgentSettingsApiKey("sk-target-bound")

  removeFailure = new Error("secure delete unavailable")
  try {
    await assert.rejects(
      writeAgentPublicConfigFileSection("settings", {
        baseURL: "https://new.example.test/v1",
        model: "new-model",
        includeHomeContext: false,
        defaultAgentMode: false,
        approvalPolicy: "auto",
      }),
      /secure delete unavailable/,
    )
    assert.equal(getAgentSettings().baseURL, "https://old.example.test/v1")
    assert.equal(getAgentSettings().apiKey, "sk-target-bound")
  } finally {
    removeFailure = null
  }

  await writeAgentPublicConfigFileSection("settings", {
    baseURL: "https://new.example.test/v1",
    model: "new-model",
    includeHomeContext: false,
    defaultAgentMode: false,
    approvalPolicy: "auto",
  })
  assert.equal(getAgentSettings().baseURL, "https://new.example.test/v1")
  assert.equal(getAgentSettings().apiKey, "")
  assert.equal(
    mem.get(secureFallbackStorageKey(SECURE_STORE_KEYS.AGENT_SETTINGS_API_KEY)),
    undefined,
  )
})
