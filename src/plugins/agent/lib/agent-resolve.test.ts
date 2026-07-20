import assert from "node:assert/strict"
import { test } from "node:test"
import { SECURE_STORE_KEYS } from "@/lib/secure-store"
import { createWorkspace, updateWorkspace } from "../agent-workspace-write-adapter"
import { AGENT_SETTINGS_STORAGE_KEY } from "./agent-settings"
import { ACP_SETTINGS_STORAGE_KEY } from "./acp/acp-settings"
import { resolveWorkspaceRun } from "./agent-resolve"

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  }
}

test("agent resolve: secure hydration rebinds a stale render snapshot by workspace id", async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage(),
    configurable: true,
  })

  try {
    const stale = await createWorkspace("Stale workspace")
    await updateWorkspace(stale.id, (current) => ({
      ...current,
      name: "Fresh workspace",
      capabilities: {
        ...current.capabilities,
        permissions: ["fs:read"],
        toolAllowlist: ["files.list"],
      },
      prompt: {
        ...current.prompt,
        precise: true,
        override: "fresh system prompt",
      },
      model: {
        useGlobal: false,
        baseURL: "https://fresh.example.test/v1",
        model: "fresh-model",
        apiKey: "fresh-key",
      },
    }))

    const resolved = await resolveWorkspaceRun(stale, true)

    assert.ok(resolved)
    assert.equal(resolved.backend, "model")
    assert.equal(resolved.baseURL, "https://fresh.example.test/v1")
    assert.equal(resolved.model, "fresh-model")
    assert.equal(resolved.apiKey, "fresh-key")
    assert.equal(resolved.system, "fresh system prompt")
    assert.deepEqual(resolved.mcp?.permissions, ["fs:read"])
    assert.deepEqual(resolved.mcp?.toolAllowlist, ["files.list"])

    const withTray = await resolveWorkspaceRun(
      stale,
      true,
      "[来源 node:note:n1] Research\nSelected evidence",
    )
    assert.equal(withTray?.backend, "model")
    assert.match(withTray?.system ?? "", /^fresh system prompt/)
    assert.match(withTray?.system ?? "", /明确加入上下文托盘/)
    assert.match(withTray?.system ?? "", /Selected evidence/)
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage)
    else Reflect.deleteProperty(globalThis, "localStorage")
  }
})

test("agent resolve: global model waits for native secure credential hydration", async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const storage = memoryStorage()
  storage.setItem(
    AGENT_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      baseURL: "https://global.example.test/v1",
      model: "global-model",
      includeHomeContext: false,
      defaultAgentMode: false,
      approvalPolicy: "confirm",
    }),
  )
  let releaseCredential!: () => void
  const credentialGate = new Promise<void>((resolve) => {
    releaseCredential = resolve
  })
  let credentialReadStarted!: () => void
  const credentialRead = new Promise<void>((resolve) => {
    credentialReadStarted = resolve
  })

  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })
  Object.defineProperty(globalThis, "window", {
    value: {
      __TAURI_INTERNALS__: {
        async invoke(command: string, args?: { key?: string }) {
          assert.equal(command, "secure_store_get")
          if (args?.key !== SECURE_STORE_KEYS.AGENT_SETTINGS_API_KEY) return null
          credentialReadStarted()
          await credentialGate
          return "sk-native-global"
        },
      },
    },
    configurable: true,
  })

  try {
    const workspace = await createWorkspace("Global workspace")
    await updateWorkspace(workspace.id, (current) => ({
      ...current,
      prompt: { ...current.prompt, precise: true, override: "global system prompt" },
      model: { useGlobal: true, baseURL: "", model: "", apiKey: "" },
    }))

    let settled = false
    const pending = resolveWorkspaceRun(workspace, false).then((result) => {
      settled = true
      return result
    })
    await credentialRead
    await Promise.resolve()
    assert.equal(settled, false)

    releaseCredential()
    const resolved = await pending
    assert.ok(resolved)
    assert.equal(resolved.backend, "model")
    assert.equal(resolved.baseURL, "https://global.example.test/v1")
    assert.equal(resolved.model, "global-model")
    assert.equal(resolved.apiKey, "sk-native-global")
    assert.equal(resolved.system, "global system prompt")
  } finally {
    releaseCredential()
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow)
    else Reflect.deleteProperty(globalThis, "window")
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage)
    else Reflect.deleteProperty(globalThis, "localStorage")
  }
})

test("agent resolve: selected external ACP backend does not require a model credential", async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const storage = memoryStorage()
  storage.setItem(
    ACP_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      allowEditorConnect: false,
      listenPort: 0,
      executionBackend: "external-acp",
      externalAgent: { program: "echo-agent", args: "--stdio", cwd: "/tmp" },
    }),
  )
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })

  try {
    const workspace = await createWorkspace("External workspace")
    await updateWorkspace(workspace.id, (current) => ({
      ...current,
      prompt: { ...current.prompt, precise: true, override: "external system prompt" },
      model: { useGlobal: false, baseURL: "", model: "", apiKey: "" },
    }))

    const resolved = await resolveWorkspaceRun(workspace, true)
    assert.ok(resolved)
    assert.equal(resolved.backend, "external-acp")
    assert.equal(resolved.externalAgent.program, "echo-agent")
    assert.equal(resolved.system, "external system prompt")
    assert.equal("mcp" in resolved, false)
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage)
    else Reflect.deleteProperty(globalThis, "localStorage")
  }
})
