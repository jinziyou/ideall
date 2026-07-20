import assert from "node:assert/strict"
import { test } from "node:test"
import type { FileRef } from "@protocol/file-system"
import { AGENT_SETTINGS_FILE_REF } from "@/filesystem/builtin-app-roots"
import {
  agentConfigFileRef,
  createAgentConfigFileSystem,
  type AgentConfigFileSystemDeps,
} from "./agent-config-file-system"
import {
  AGENT_SETTINGS_SET_API_KEY_ACTION,
  DEFAULT_AGENT_SETTINGS_DOCUMENT,
} from "./agent-settings-file-contract"
import {
  importAgentConfigJsonWithFileLocks,
  persistAgentSettingsWithFileLock,
  withAgentConfigSectionWriteLocks,
} from "./agent-settings-write-adapter"
import { agentManifest } from "./manifest"
import { AGENT_PUBLIC_CONFIG_SECTIONS } from "./lib/agent-data-port"
import type { AgentSettings } from "./lib/agent-settings"

const UI_WRITE = { actor: "ui", permissions: [], intent: "write" } as const
const UI_ACTION = { actor: "ui", permissions: [], intent: "action" } as const

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitForItems(items: readonly unknown[], expectedLength: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (items.length < expectedLength && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(
    items.length,
    expectedLength,
    `Timed out waiting for ${expectedLength} watch events; received ${items.length}`,
  )
}

async function drainAsyncWatchWork(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

class AgentBroadcastChannelMock extends EventTarget {
  static instances: AgentBroadcastChannelMock[] = []

  constructor(readonly name: string) {
    super()
    AgentBroadcastChannelMock.instances.push(this)
  }

  postMessage(): void {}

  close(): void {}

  receive(value: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: value }))
  }
}

test("agent settings write adapter: legacy persistence serializes with config provider writes", async () => {
  const events: string[] = []
  const legacyEntered = deferred()
  const releaseLegacy = deferred()
  let publicSettings = { ...DEFAULT_AGENT_SETTINGS_DOCUMENT }
  const deps: AgentConfigFileSystemDeps = {
    read(section) {
      assert.equal(section, "settings")
      return publicSettings
    },
    write(section, value) {
      assert.equal(section, "settings")
      events.push("provider:write")
      publicSettings = value as typeof publicSettings
    },
    subscribe() {
      return () => undefined
    },
  }
  const provider = createAgentConfigFileSystem(deps)
  const legacySettings: AgentSettings = {
    ...DEFAULT_AGENT_SETTINGS_DOCUMENT,
    model: "legacy-model",
    apiKey: "sk-legacy",
  }

  const legacyWrite = persistAgentSettingsWithFileLock(legacySettings, async () => {
    events.push("legacy:start")
    legacyEntered.resolve()
    await releaseLegacy.promise
    events.push("legacy:end")
  })
  await legacyEntered.promise

  const providerWrite = provider.write(
    AGENT_SETTINGS_FILE_REF,
    {
      data: { ...DEFAULT_AGENT_SETTINGS_DOCUMENT, model: "provider-model" },
    },
    UI_WRITE,
  )
  await Promise.resolve()
  assert.deepEqual(events, ["legacy:start"], "provider must wait for the legacy writer")

  releaseLegacy.resolve()
  await Promise.all([legacyWrite, providerWrite])

  assert.deepEqual(events, ["legacy:start", "legacy:end", "provider:write"])
  assert.equal(publicSettings.model, "provider-model")
})

test("agent settings write adapter: config import waits for credential actions", async () => {
  const events: string[] = []
  const credentialEntered = deferred()
  const releaseCredential = deferred()
  let credentialRevision = 0
  const deps: AgentConfigFileSystemDeps = {
    read() {
      return DEFAULT_AGENT_SETTINGS_DOCUMENT
    },
    write() {
      throw new Error("unexpected public write")
    },
    subscribe() {
      return () => undefined
    },
    settingsCredentialRevision() {
      return String(credentialRevision)
    },
    async writeSettingsApiKey() {
      events.push("credential:start")
      credentialEntered.resolve()
      await releaseCredential.promise
      credentialRevision += 1
      events.push("credential:end")
    },
  }
  const provider = createAgentConfigFileSystem(deps)
  const credentialWrite = provider.invoke(
    AGENT_SETTINGS_FILE_REF,
    AGENT_SETTINGS_SET_API_KEY_ACTION,
    { apiKey: "sk-provider" },
    UI_ACTION,
  )
  await credentialEntered.promise

  const imported = importAgentConfigJsonWithFileLocks("agent-package", async (raw) => {
    assert.equal(raw, "agent-package")
    events.push("import")
    return { keys: 2 }
  })
  await Promise.resolve()
  assert.deepEqual(events, ["credential:start"], "import must wait for the credential writer")

  releaseCredential.resolve()
  const [, result] = await Promise.all([credentialWrite, imported])

  assert.deepEqual(result, { keys: 2 })
  assert.deepEqual(events, ["credential:start", "credential:end", "import"])
})

test("agent config import: waits for a non-settings provider write", async () => {
  const events: string[] = []
  const mcpWriteEntered = deferred()
  const releaseMcpWrite = deferred()
  const deps: AgentConfigFileSystemDeps = {
    read(section) {
      assert.equal(section, "mcp")
      return []
    },
    async write(section, value) {
      assert.equal(section, "mcp")
      assert.deepEqual(value, [])
      events.push("mcp:start")
      mcpWriteEntered.resolve()
      await releaseMcpWrite.promise
      events.push("mcp:end")
    },
    subscribe() {
      return () => undefined
    },
  }
  const provider = createAgentConfigFileSystem(deps)
  const providerWrite = provider.write(agentConfigFileRef("mcp"), { data: [] }, UI_WRITE)
  await mcpWriteEntered.promise

  const imported = importAgentConfigJsonWithFileLocks("agent-package", async () => {
    events.push("import")
    return { keys: 1 }
  })
  await Promise.resolve()
  assert.deepEqual(events, ["mcp:start"], "import must wait for the MCP writer")

  releaseMcpWrite.resolve()
  await Promise.all([providerWrite, imported])
  assert.deepEqual(events, ["mcp:start", "mcp:end", "import"])
})

test("agent config import: acquires stable section order and releases in reverse", async () => {
  const events: string[] = []
  async function tracingLock<T>(ref: FileRef, operation: () => T | Promise<T>): Promise<T> {
    events.push(`acquire:${ref.fileId}`)
    try {
      return await operation()
    } finally {
      events.push(`release:${ref.fileId}`)
    }
  }

  await withAgentConfigSectionWriteLocks(() => events.push("operation"), tracingLock)

  const fileIds = [
    "config:mcp",
    "config:rules",
    "config:settings",
    "config:skills",
    "config:tasks",
    "config:workspaces",
  ]
  assert.deepEqual(events, [
    ...fileIds.map((fileId) => `acquire:${fileId}`),
    "operation",
    ...[...fileIds].reverse().map((fileId) => `release:${fileId}`),
  ])
})

test("agent data-port import uses store notifications locally and broadcast invalidation remotely", async () => {
  const previousWindow = globalThis.window
  AgentBroadcastChannelMock.instances = []
  const windowTarget = new EventTarget()
  Object.defineProperty(windowTarget, "BroadcastChannel", {
    value: AgentBroadcastChannelMock,
    configurable: true,
  })
  Object.defineProperty(globalThis, "window", { value: windowTarget, configurable: true })

  const listeners = new Map<string, Set<() => void>>()
  const deps: AgentConfigFileSystemDeps = {
    read() {
      return DEFAULT_AGENT_SETTINGS_DOCUMENT
    },
    write() {
      throw new Error("unexpected provider write")
    },
    subscribe(section, listener) {
      const sectionListeners = listeners.get(section) ?? new Set<() => void>()
      sectionListeners.add(listener)
      listeners.set(section, sectionListeners)
      return () => sectionListeners.delete(listener)
    },
  }
  const provider = createAgentConfigFileSystem(deps)
  const rootEvents: string[] = []
  const rootVersions: Array<string | undefined> = []
  const settingsEvents: string[] = []
  const settingsVersions: Array<string | undefined> = []
  const watchCtx = { actor: "ui", permissions: [], intent: "watch" } as const
  const rootWatch = provider.watch?.(provider.descriptor.root, watchCtx, (event) => {
    rootEvents.push(event.ref.fileId)
    rootVersions.push(event.version)
  })
  const settingsWatch = provider.watch?.(AGENT_SETTINGS_FILE_REF, watchCtx, (event) => {
    settingsEvents.push(event.ref.fileId)
    settingsVersions.push(event.version)
  })

  try {
    assert.ok(rootWatch)
    assert.ok(settingsWatch)
    assert.equal(AgentBroadcastChannelMock.instances.length, 1)

    const result = await importAgentConfigJsonWithFileLocks("agent-package", async () => {
      for (const listener of [...(listeners.get("settings") ?? [])]) listener()
      return { keys: 1 }
    })
    assert.deepEqual(result, { keys: 1 })
    await Promise.all([waitForItems(rootEvents, 1), waitForItems(settingsEvents, 1)])
    assert.deepEqual(rootEvents, [AGENT_SETTINGS_FILE_REF.fileId])
    assert.deepEqual(settingsEvents, [AGENT_SETTINGS_FILE_REF.fileId])

    // 其它 Tauri 窗口只发送 scope；当前窗口会重新读取全部被观察 section。
    AgentBroadcastChannelMock.instances[0].receive({
      sender: "another-tauri-window",
      fileSystemId: AGENT_SETTINGS_FILE_REF.fileSystemId,
    })
    assert.deepEqual(
      rootEvents.slice(1).sort(),
      AGENT_PUBLIC_CONFIG_SECTIONS.map(({ id }) => agentConfigFileRef(id).fileId).sort(),
    )
    assert.deepEqual(settingsEvents, [
      AGENT_SETTINGS_FILE_REF.fileId,
      AGENT_SETTINGS_FILE_REF.fileId,
    ])
    assert.equal(rootVersions[0] !== undefined, true)
    assert.equal(settingsVersions[0] !== undefined, true)
    assert.deepEqual(
      rootVersions.slice(1),
      new Array(AGENT_PUBLIC_CONFIG_SECTIONS.length).fill(undefined),
    )
    assert.deepEqual(settingsVersions.slice(1), [undefined])

    const rootCount = rootEvents.length
    const settingsCount = settingsEvents.length
    await assert.rejects(
      importAgentConfigJsonWithFileLocks("broken-package", async () => {
        throw new Error("agent import rejected")
      }),
      /agent import rejected/,
    )
    assert.equal(rootEvents.length, rootCount)
    assert.equal(settingsEvents.length, settingsCount)
  } finally {
    rootWatch?.dispose()
    settingsWatch?.dispose()
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window")
    else {
      Object.defineProperty(globalThis, "window", {
        value: previousWindow,
        configurable: true,
      })
    }
  }
})

test("agent data-port watch: remote invalidation supersedes a pending local version", async () => {
  const previousWindow = globalThis.window
  AgentBroadcastChannelMock.instances = []
  const windowTarget = new EventTarget()
  Object.defineProperty(windowTarget, "BroadcastChannel", {
    value: AgentBroadcastChannelMock,
    configurable: true,
  })
  Object.defineProperty(globalThis, "window", { value: windowTarget, configurable: true })

  const listeners = new Map<string, Set<() => void>>()
  const provider = createAgentConfigFileSystem({
    read() {
      return DEFAULT_AGENT_SETTINGS_DOCUMENT
    },
    write() {
      throw new Error("unexpected provider write")
    },
    subscribe(section, listener) {
      const sectionListeners = listeners.get(section) ?? new Set<() => void>()
      sectionListeners.add(listener)
      listeners.set(section, sectionListeners)
      return () => sectionListeners.delete(listener)
    },
  })
  const events: Array<{ fileId: string; version?: string }> = []
  const watch = provider.watch?.(
    AGENT_SETTINGS_FILE_REF,
    { actor: "ui", permissions: [], intent: "watch" },
    (event) => events.push({ fileId: event.ref.fileId, version: event.version }),
  )

  try {
    assert.ok(watch)
    assert.equal(AgentBroadcastChannelMock.instances.length, 1)

    const settingsListeners = [...(listeners.get("settings") ?? [])]
    assert.equal(settingsListeners.length, 1)
    settingsListeners[0]()
    AgentBroadcastChannelMock.instances[0].receive({
      sender: "another-tauri-window",
      fileSystemId: AGENT_SETTINGS_FILE_REF.fileSystemId,
    })

    assert.deepEqual(events, [{ fileId: AGENT_SETTINGS_FILE_REF.fileId, version: undefined }])
    await drainAsyncWatchWork()
    assert.deepEqual(events, [{ fileId: AGENT_SETTINGS_FILE_REF.fileId, version: undefined }])
  } finally {
    watch?.dispose()
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window")
    else {
      Object.defineProperty(globalThis, "window", {
        value: previousWindow,
        configurable: true,
      })
    }
  }
})

test("agent manifest: importJson routes through the section lock adapter", () => {
  assert.equal(agentManifest.dataPorts[0]?.importJson, importAgentConfigJsonWithFileLocks)
})
