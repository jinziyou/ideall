import assert from "node:assert/strict"
import { test } from "node:test"
import { FileSystemError } from "@/filesystem/types"
import { withFileWriteLock } from "@/filesystem/write-lock"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import {
  AGENT_AUDIT_FILE_REF,
  AGENT_AUDIT_FILE_SYSTEM_ID,
  AGENT_CONFIG_ROOT_MEDIA_TYPE,
  AGENT_CONFIG_ROOT_REF,
  AGENT_SETTINGS_FILE_REF,
  AGENT_SETTINGS_MEDIA_TYPE,
  AGENT_TASKS_FILE_REF,
  AGENT_TASKS_MEDIA_TYPE,
  AGENT_WORKSPACES_FILE_REF,
  AGENT_WORKSPACES_MEDIA_TYPE,
} from "@/filesystem/builtin-app-roots"
import { agentAuditFileSystem } from "./agent-audit-file-system"
import {
  AgentWorkspaceNotFoundError,
  sanitizeAgentPublicConfigSection,
  type AgentPublicConfigSectionId,
} from "./lib/agent-data-port"
import {
  AGENT_WORKSPACE_ACTIVATE_ACTION,
  AGENT_WORKSPACE_CREATE_ACTION,
  MAX_AGENT_MANAGEMENT_STRING_LENGTH,
  MAX_AGENT_TASK_ITEMS,
  type AgentWorkspaceCreateResult,
} from "./agent-management-file-contract"
import {
  AGENT_SETTINGS_ACP_DETECT_ACTION,
  AGENT_SETTINGS_ACP_PROBE_ACTION,
  AGENT_SETTINGS_ACP_READ_ACTION,
  AGENT_SETTINGS_ACP_WRITE_ACTION,
  AGENT_SETTINGS_CLEAR_API_KEY_ACTION,
  AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION,
  AGENT_SETTINGS_SET_API_KEY_ACTION,
  DEFAULT_AGENT_ACP_SETTINGS,
  MAX_AGENT_SETTINGS_API_KEY_LENGTH,
} from "./agent-settings-file-contract"
import { agentManifest } from "./manifest"
import type { McpServer } from "./lib/agent-mcp-registry"
import { AGENT_SETTINGS_STORAGE_KEY } from "./lib/agent-settings"
import {
  AGENT_CONFIG_FILE_SYSTEM_ID,
  AGENT_MCP_CREATE_ACTION,
  AGENT_MCP_PROBE_ACTION,
  agentConfigFileSystem,
  agentConfigFileRef,
  createAgentConfigFileSystem,
  type AgentConfigFileSystemDeps,
} from "./agent-config-file-system"

type FakeAgentConfig = Record<AgentPublicConfigSectionId, unknown>

function fakeDeps(
  initial?: Partial<FakeAgentConfig>,
  initialCredential = "sk-never-expose",
): {
  deps: AgentConfigFileSystemDeps
  state: FakeAgentConfig
  emit(section: AgentPublicConfigSectionId): void
  credential(): string
  credentialRevision(): string
  workspaceRevision(): string
  advanceWorkspaceRevision(): void
} {
  const state: FakeAgentConfig = {
    settings: {
      baseURL: "https://api.example.test/v1",
      model: "test-model",
      apiKey: "sk-never-expose",
      accessToken: "settings-token",
      includeHomeContext: true,
      defaultAgentMode: true,
      approvalPolicy: "confirm",
    },
    workspaces: {
      workspaces: [
        {
          id: "ws-1",
          name: "真实工作区",
          model: { useGlobal: false, model: "m", baseURL: "u", apiKey: "ws-secret" },
        },
      ],
      activeId: "ws-1",
    },
    rules: [
      {
        id: "rule-1",
        name: "真实规则",
        description: "",
        activation: "always",
        glob: "",
        body: "answer briefly",
        scope: "global",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    skills: [{ id: "skill-1", label: "真实技能", hint: "hint", prompt: "do it" }],
    mcp: [
      {
        id: "mcp-1",
        name: "Private MCP",
        transport: "http",
        command: "",
        args: "--access-token cli-secret --safe yes",
        url: "https://user:password@example.test/mcp?access_token=url-secret&view=full",
        env: [
          { key: "OPENAI_API_KEY", value: "env-secret" },
          { key: "SAFE_MODE", value: "1" },
        ],
        headers: [
          { key: "Authorization", value: "Bearer header-secret" },
          { key: "Accept", value: "application/json" },
        ],
        auth: "none",
        enabled: true,
        builtin: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    tasks: [
      {
        id: "thread-1",
        workspaceId: "ws-1",
        status: "active",
        starred: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    ...initial,
  }
  const listeners = new Map<AgentPublicConfigSectionId, Set<() => void>>()
  let credential = initialCredential
  let credentialRevision = 0
  let workspaceRevision = 0
  let nextWorkspaceNumber = 2
  const emit = (section: AgentPublicConfigSectionId) => {
    for (const listener of listeners.get(section) ?? []) listener()
  }
  return {
    state,
    emit,
    credential: () => credential,
    credentialRevision: () => String(credentialRevision),
    workspaceRevision: () => String(workspaceRevision),
    advanceWorkspaceRevision: () => {
      workspaceRevision += 1
    },
    deps: {
      read(section) {
        return state[section]
      },
      write(section, value) {
        state[section] = sanitizeAgentPublicConfigSection(section, value)
        if (section === "workspaces") workspaceRevision += 1
        emit(section)
      },
      subscribe(section, listener) {
        const current = listeners.get(section) ?? new Set()
        current.add(listener)
        listeners.set(section, current)
        return () => current.delete(listener)
      },
      settingsCredentialConfigured() {
        return Boolean(credential)
      },
      settingsCredentialRevision() {
        return String(credentialRevision)
      },
      workspaceRevision() {
        return String(workspaceRevision)
      },
      async readSettingsCredentialConfigured() {
        return Boolean(credential)
      },
      async writeSettingsApiKey(apiKey) {
        credential = apiKey
        credentialRevision += 1
        emit("settings")
      },
      async deleteSettingsApiKey() {
        credential = ""
        credentialRevision += 1
        emit("settings")
      },
      createWorkspace(name) {
        const workspaceId = `ws-${nextWorkspaceNumber++}`
        const workspaceName = name ?? `工作区 ${workspaceId.slice(3)}`
        const current = state.workspaces as {
          workspaces: Array<{ id: string; name: string }>
          activeId: string
        }
        current.workspaces.push({ id: workspaceId, name: workspaceName })
        workspaceRevision += 1
        emit("workspaces")
        return { workspaceId, name: workspaceName }
      },
      activateWorkspace(workspaceId) {
        const current = state.workspaces as {
          workspaces: Array<{ id: string; name: string }>
          activeId: string
        }
        if (!current.workspaces.some((workspace) => workspace.id === workspaceId)) {
          throw new AgentWorkspaceNotFoundError()
        }
        current.activeId = workspaceId
        workspaceRevision += 1
        emit("workspaces")
        return { workspaceId }
      },
    },
  }
}

const UI_METADATA = { actor: "ui", permissions: [], intent: "metadata" } as const
const UI_DIRECTORY = { actor: "ui", permissions: [], intent: "directory" } as const
const UI_CONTENT = { actor: "ui", permissions: [], intent: "content" } as const
const UI_WRITE = { actor: "ui", permissions: [], intent: "write" } as const
const UI_ACTION = { actor: "ui", permissions: [], intent: "action" } as const
const UI_WATCH = { actor: "ui", permissions: [], intent: "watch" } as const

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
  if (items.length >= expectedLength) return
  assert.fail(`Timed out waiting for ${expectedLength} watch events; received ${items.length}`)
}

test("agent config filesystem: default settings snapshot waits for native credential hydration", async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const memory = new Map<string, string>([
    [
      AGENT_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        baseURL: "https://api.example.test/v1",
        model: "native-model",
        includeHomeContext: true,
        defaultAgentMode: true,
        approvalPolicy: "confirm",
      }),
    ],
  ])
  const storageStub: Storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
    removeItem: (key) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size
    },
  }
  let nativeSecret = "sk-native-hydrated-A"
  let releaseInitialRead!: () => void
  const initialReadGate = new Promise<void>((resolve) => {
    releaseInitialRead = resolve
  })
  let secureReads = 0
  Object.defineProperty(globalThis, "localStorage", {
    value: storageStub,
    configurable: true,
  })
  Object.defineProperty(globalThis, "window", {
    value: {
      __TAURI_INTERNALS__: {
        async invoke(command: string) {
          assert.equal(command, "secure_store_get")
          secureReads += 1
          if (secureReads === 1) await initialReadGate
          return nativeSecret
        },
      },
    },
    configurable: true,
  })

  const fs = createAgentConfigFileSystem()
  const ref = agentConfigFileRef("settings")
  const events: Array<string | undefined> = []
  const watchReads: Array<Promise<void>> = []
  const handle = fs.watch?.(ref, UI_WATCH, (event) => {
    events.push(event.version)
    // Mirrors useFileDocument: every invalidation re-reads the watched file. Cap retries so a
    // regression fails deterministically instead of starving the test runner with a microtask loop.
    if (events.length <= 3) {
      watchReads.push(fs.read(ref, UI_CONTENT).then(() => undefined))
    }
  })
  let firstSettled = false
  const firstPending = fs.read(ref, UI_CONTENT).then((result) => {
    firstSettled = true
    return result
  })
  let statSettled = false
  const statPending = fs.stat(ref, UI_METADATA).then((result) => {
    statSettled = true
    return result
  })

  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(firstSettled, false)
    assert.equal(statSettled, false)
    assert.deepEqual(events, [])

    releaseInitialRead()
    const [first, metadata] = await Promise.all([firstPending, statPending])
    await waitForItems(events, 1)
    assert.match(first.version ?? "", /^agent-config-v2:[0-9a-f]{64}$/)
    assert.equal(metadata?.version, first.version)
    assert.equal(events[0], first.version)
    assert.equal(JSON.stringify(first).includes(nativeSecret), false)

    for (let index = 0; index < watchReads.length; index += 1) await watchReads[index]
    await new Promise<void>((resolve) => setImmediate(resolve))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(events.length, 1)
    assert.equal(watchReads.length, 1)
    assert.equal(secureReads, 1)

    nativeSecret = "sk-native-hydrated-B"
    const repeated = await fs.read(ref, UI_CONTENT)
    assert.equal(repeated.version, first.version)
    assert.equal(JSON.stringify(repeated).includes(nativeSecret), false)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(events.length, 1)
    assert.equal(secureReads, 1)
  } finally {
    releaseInitialRead()
    handle?.dispose()
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage)
    else Reflect.deleteProperty(globalThis, "localStorage")
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow)
    else Reflect.deleteProperty(globalThis, "window")
  }
})

test("agent config filesystem: task-backed read prepare serializes with runtime writers", async () => {
  type Provider = ReturnType<typeof createAgentConfigFileSystem>
  const scenarios: Array<{
    label: string
    section: "tasks" | "workspaces"
    run(provider: Provider): Promise<unknown>
  }> = [
    {
      label: "tasks stat",
      section: "tasks",
      run: (provider) => provider.stat(AGENT_TASKS_FILE_REF, UI_METADATA),
    },
    {
      label: "tasks read",
      section: "tasks",
      run: (provider) => provider.read(AGENT_TASKS_FILE_REF, UI_CONTENT),
    },
    {
      label: "tasks directory",
      section: "tasks",
      run: (provider) => provider.readDirectory(AGENT_TASKS_FILE_REF, UI_DIRECTORY),
    },
    {
      label: "workspaces stat",
      section: "workspaces",
      run: (provider) => provider.stat(AGENT_WORKSPACES_FILE_REF, UI_METADATA),
    },
    {
      label: "workspaces read",
      section: "workspaces",
      run: (provider) => provider.read(AGENT_WORKSPACES_FILE_REF, UI_CONTENT),
    },
  ]

  for (const scenario of scenarios) {
    const fixture = fakeDeps()
    const prepareStarted = deferred()
    const releasePrepare = deferred()
    let prepareCalls = 0
    const writerEntries: string[] = []
    const provider = createAgentConfigFileSystem({
      ...fixture.deps,
      async prepare(section) {
        assert.equal(section, scenario.section, scenario.label)
        prepareCalls += 1
        prepareStarted.resolve()
        await releasePrepare.promise
      },
    })

    const readPending = scenario.run(provider)
    await prepareStarted.promise
    const competingRefs =
      scenario.section === "workspaces"
        ? [AGENT_TASKS_FILE_REF, AGENT_WORKSPACES_FILE_REF]
        : [AGENT_TASKS_FILE_REF]
    const writerPending = competingRefs.map((ref) =>
      withFileWriteLock(ref, () => {
        writerEntries.push(ref.fileId)
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    try {
      assert.deepEqual(writerEntries, [], `${scenario.label} must retain all dependency locks`)
      assert.equal(prepareCalls, 1, scenario.label)
    } finally {
      releasePrepare.resolve()
    }
    await readPending
    await Promise.all(writerPending)
    assert.deepEqual(
      new Set(writerEntries),
      new Set(competingRefs.map((ref) => ref.fileId)),
      `${scenario.label} must release all dependency locks`,
    )
  }
})

test("agent config filesystem: workspace reads acquire tasks before workspaces", async () => {
  const fixture = fakeDeps()
  const workspaceLockEntered = deferred()
  const releaseWorkspaceLock = deferred()
  const holder = withFileWriteLock(AGENT_WORKSPACES_FILE_REF, async () => {
    workspaceLockEntered.resolve()
    await releaseWorkspaceLock.promise
  })
  await workspaceLockEntered.promise

  let prepareCalls = 0
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    prepare(section) {
      assert.equal(section, "workspaces")
      prepareCalls += 1
    },
  })
  const readPending = fs.read(AGENT_WORKSPACES_FILE_REF, UI_CONTENT)
  await new Promise<void>((resolve) => setImmediate(resolve))

  let taskWriterEntered = false
  const taskWriter = withFileWriteLock(AGENT_TASKS_FILE_REF, () => {
    taskWriterEntered = true
  })
  await Promise.resolve()
  await Promise.resolve()

  try {
    assert.equal(prepareCalls, 0, "read must still be waiting for the workspace lock")
    assert.equal(taskWriterEntered, false, "read must retain tasks while waiting for workspaces")
  } finally {
    releaseWorkspaceLock.resolve()
  }
  await holder
  await readPending
  await taskWriter
  assert.equal(prepareCalls, 1)
  assert.equal(taskWriterEntered, true)
})

test("agent config filesystem: exposes six stable JSON files backed by real config", async () => {
  const fixture = fakeDeps()
  const fs = createAgentConfigFileSystem(fixture.deps)

  assert.equal(fs.descriptor.fileSystemId, AGENT_CONFIG_FILE_SYSTEM_ID)
  assert.deepEqual(fs.descriptor.root, AGENT_CONFIG_ROOT_REF)
  const root = await fs.stat(fs.descriptor.root, UI_METADATA)
  assert.equal(root?.mediaType, AGENT_CONFIG_ROOT_MEDIA_TYPE)
  assert.equal(root?.properties?.agentConfigRoot, true)
  const first = await fs.readDirectory(fs.descriptor.root, UI_DIRECTORY, { limit: 2 })
  const second = await fs.readDirectory(fs.descriptor.root, UI_DIRECTORY, {
    cursor: first.nextCursor,
  })
  assert.deepEqual(
    [...first.entries, ...second.entries].map((entry) => entry.name),
    ["settings.json", "workspaces.json", "rules.json", "skills.json", "mcp.json", "tasks.json"],
  )
  assert.deepEqual(
    [...first.entries, ...second.entries].map((entry) => entry.entryId),
    ["settings", "workspaces", "rules", "skills", "mcp", "tasks"],
  )
  await assert.rejects(
    fs.readDirectory(fs.descriptor.root, UI_DIRECTORY, {
      cursor: "999999999999999999999999999999",
    }),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  await assert.rejects(
    fs.readDirectory(fs.descriptor.root, UI_DIRECTORY, {
      limit: Number.MAX_SAFE_INTEGER + 1,
    }),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )

  const rules = await fs.read(agentConfigFileRef("rules"), UI_CONTENT)
  assert.deepEqual(rules.data, fixture.state.rules)
  assert.equal(JSON.stringify(rules.data).includes("panel"), false)
  assert.equal(rules.mediaType, "application/json")

  const skills = await fs.read(agentConfigFileRef("skills"), UI_CONTENT)
  assert.deepEqual(skills.data, fixture.state.skills)
})

test("agent config filesystem: versions are deterministic namespaced SHA-256 tokens", async () => {
  const fixture = fakeDeps()
  const fs = createAgentConfigFileSystem(fixture.deps)
  const ref = agentConfigFileRef("rules")
  const originalValue = fixture.state.rules

  const first = await fs.read(ref, UI_CONTENT)
  const repeated = await fs.read(ref, UI_CONTENT)
  const metadata = await fs.stat(ref, UI_METADATA)
  assert.match(first.version ?? "", /^agent-config-v2:[0-9a-f]{64}$/)
  assert.equal(repeated.version, first.version)
  assert.equal(metadata?.version, first.version)

  fixture.state.rules = (originalValue as Array<Record<string, unknown>>).map((rule) => ({
    ...rule,
    body: "changed semantic content",
  }))
  assert.notEqual((await fs.read(ref, UI_CONTENT)).version, first.version)

  fixture.state.rules = originalValue
  assert.equal((await fs.read(ref, UI_CONTENT)).version, first.version)
})

test("agent config filesystem: settings credential state and opaque version independently invalidate snapshots", async () => {
  const fixture = fakeDeps(undefined, "")
  let configured = false
  let credentialVersion = "0"
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    settingsCredentialConfigured: () => configured,
    settingsCredentialRevision: () => credentialVersion,
  })
  const ref = agentConfigFileRef("settings")
  const initial = await fs.read(ref, UI_CONTENT)

  configured = true
  const configuredSnapshot = await fs.read(ref, UI_CONTENT)
  assert.notEqual(configuredSnapshot.version, initial.version)

  configured = false
  assert.equal((await fs.read(ref, UI_CONTENT)).version, initial.version)

  credentialVersion = "1"
  const revisedSnapshot = await fs.read(ref, UI_CONTENT)
  assert.notEqual(revisedSnapshot.version, initial.version)
  assert.notEqual(revisedSnapshot.version, configuredSnapshot.version)

  credentialVersion = "0"
  assert.equal((await fs.read(ref, UI_CONTENT)).version, initial.version)
})

test("agent config filesystem: ACP device settings, discovery, and probe stay behind specialized actions", async () => {
  const fixture = fakeDeps()
  let acpSettings = DEFAULT_AGENT_ACP_SETTINGS
  const acpListeners = new Set<() => void>()
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    readAcpSettings: () => acpSettings,
    writeAcpSettings(next) {
      acpSettings = next
      for (const listener of acpListeners) listener()
    },
    subscribeAcpSettings(listener) {
      acpListeners.add(listener)
      return () => acpListeners.delete(listener)
    },
    detectAcpAgents: () => [
      {
        id: "echo",
        label: "回显 Agent",
        config: { program: "node", args: '"/safe/echo agent.mjs"', cwd: "/safe" },
      },
    ],
    probeAcpAgent(config) {
      assert.equal(config.program, "node")
      return { latencyMs: 12, protocolVersion: 1 }
    },
  })
  const ref = agentConfigFileRef("settings")
  const initial = await fs.read(ref, UI_CONTENT)
  assert.equal(JSON.stringify(initial.data).includes("externalAgent"), false)
  assert.deepEqual(
    await fs.invoke(ref, AGENT_SETTINGS_ACP_READ_ACTION, undefined, UI_ACTION),
    DEFAULT_AGENT_ACP_SETTINGS,
  )

  const next = {
    ...DEFAULT_AGENT_ACP_SETTINGS,
    executionBackend: "external-acp" as const,
    externalAgent: { program: "node", args: '"/safe/echo agent.mjs"', cwd: "/safe" },
  }
  const written = await fs.invoke(ref, AGENT_SETTINGS_ACP_WRITE_ACTION, next, UI_ACTION, {
    expectedVersion: initial.version,
  })
  assert.deepEqual(written, next)
  const revised = await fs.read(ref, UI_CONTENT)
  assert.notEqual(revised.version, initial.version)
  assert.equal(JSON.stringify(revised.data).includes("/safe/echo"), false)

  assert.deepEqual(await fs.invoke(ref, AGENT_SETTINGS_ACP_DETECT_ACTION, undefined, UI_ACTION), [
    {
      id: "echo",
      label: "回显 Agent",
      config: { program: "node", args: '"/safe/echo agent.mjs"', cwd: "/safe" },
    },
  ])
  assert.deepEqual(
    await fs.invoke(
      ref,
      AGENT_SETTINGS_ACP_PROBE_ACTION,
      { externalAgent: next.externalAgent },
      UI_ACTION,
    ),
    { latencyMs: 12, protocolVersion: 1 },
  )

  await assert.rejects(
    fs.invoke(ref, AGENT_SETTINGS_ACP_WRITE_ACTION, DEFAULT_AGENT_ACP_SETTINGS, UI_ACTION, {
      expectedVersion: initial.version,
    }),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.deepEqual(acpSettings, next)
})

test("agent config filesystem: settings hydration rejects stale write and action CAS before backends", async () => {
  const fixture = fakeDeps(undefined, "")
  const ref = agentConfigFileRef("settings")
  const cold = createAgentConfigFileSystem(fixture.deps)
  const stale = await cold.read(ref, UI_CONTENT)
  assert.ok(stale.version)

  const writeGate = deferred()
  const actionGate = deferred()
  let prepareCalls = 0
  let semanticCredentialReads = 0
  let hydrated = false
  let publicWrites = 0
  let credentialWrites = 0
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    prepare(section) {
      if (section !== "settings") return
      prepareCalls += 1
      return prepareCalls === 1 ? writeGate.promise : actionGate.promise
    },
    settingsCredentialConfigured() {
      semanticCredentialReads += 1
      return hydrated
    },
    settingsCredentialRevision() {
      semanticCredentialReads += 1
      return hydrated ? "1" : "0"
    },
    write() {
      publicWrites += 1
    },
    writeSettingsApiKey() {
      credentialWrites += 1
    },
  })

  const writePending = fs.write(ref, { data: stale.data, expectedVersion: stale.version }, UI_WRITE)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(prepareCalls, 1)
  assert.equal(semanticCredentialReads, 0)
  assert.equal(publicWrites, 0)

  hydrated = true
  writeGate.resolve()
  await assert.rejects(
    writePending,
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.equal(publicWrites, 0)

  const actionPending = fs.invoke(
    ref,
    AGENT_SETTINGS_SET_API_KEY_ACTION,
    { apiKey: "sk-must-not-reach-backend" },
    UI_ACTION,
    { expectedVersion: stale.version },
  )
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(prepareCalls, 2)
  assert.equal(semanticCredentialReads, 2)
  assert.equal(credentialWrites, 0)

  actionGate.resolve()
  await assert.rejects(
    actionPending,
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.equal(credentialWrites, 0)
  assert.equal(semanticCredentialReads, 4)
})

test("agent config filesystem: stale SHA-256 expectedVersion rejects writes before commit", async () => {
  const fixture = fakeDeps()
  let writes = 0
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    write(section, value) {
      writes += 1
      return fixture.deps.write(section, value)
    },
  })
  const ref = agentConfigFileRef("rules")
  const stale = await fs.read(ref, UI_CONTENT)
  fixture.state.rules = (fixture.state.rules as Array<Record<string, unknown>>).map((rule) => ({
    ...rule,
    updatedAt: 2,
  }))
  const current = await fs.read(ref, UI_CONTENT)

  await assert.rejects(
    fs.write(ref, { data: stale.data, expectedVersion: stale.version }, UI_WRITE),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.equal(writes, 0)
  assert.deepEqual((await fs.read(ref, UI_CONTENT)).data, current.data)
})

test("agent config filesystem: tasks expose explicit thread FileRefs without persisting derived links", async () => {
  const fixture = fakeDeps()
  const fs = createAgentConfigFileSystem(fixture.deps)
  const ref = agentConfigFileRef("tasks")
  const current = await fs.read(ref, UI_CONTENT)
  const tasks = current.data as Array<Record<string, unknown>>

  assert.deepEqual(
    tasks[0]?.threadRef,
    resourceFileRef({ scheme: "node", kind: "thread", id: "thread-1" }),
  )

  await fs.write(ref, { data: tasks, expectedVersion: current.version }, UI_WRITE)
  assert.equal(
    "threadRef" in ((fixture.state.tasks as Array<Record<string, unknown>>)[0] ?? {}),
    false,
  )

  const tampered = tasks.map((task) => ({
    ...task,
    threadRef: { fileSystemId: "third-party.tasks", fileId: "thread-1" },
  }))
  await assert.rejects(
    fs.write(ref, { data: tampered, expectedVersion: current.version }, UI_WRITE),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
})

test("agent config filesystem: tasks JSON file also exposes a version-bound directory projection", async () => {
  const tasks = [
    {
      id: "thread-1",
      workspaceId: "ws-1",
      status: "active",
      starred: false,
      createdAt: 1,
      updatedAt: 3,
    },
    {
      id: "thread-2",
      workspaceId: "ws-2",
      status: "running",
      starred: true,
      createdAt: 2,
      updatedAt: 5,
    },
    {
      id: "thread-3",
      workspaceId: "ws-1",
      status: "done",
      starred: false,
      createdAt: 3,
      updatedAt: 5,
    },
  ]
  const fixture = fakeDeps({ tasks })
  const fs = createAgentConfigFileSystem(fixture.deps)
  const metadata = await fs.stat(AGENT_TASKS_FILE_REF, UI_METADATA)
  assert.equal(metadata?.kind, "file")
  assert.equal(metadata?.capabilities.includes("read"), true)
  assert.equal(metadata?.capabilities.includes("read-directory"), true)
  assert.equal(Array.isArray((await fs.read(AGENT_TASKS_FILE_REF, UI_CONTENT)).data), true)

  const first = await fs.readDirectory(AGENT_TASKS_FILE_REF, UI_DIRECTORY, { limit: 2 })
  assert.equal(first.entries.length, 2)
  assert.notEqual(first.nextCursor, "2", "task cursors must carry their snapshot version")
  assert.deepEqual(
    first.entries.map((entry) => entry.entryId),
    ["thread-2", "thread-3"],
    "sorting must happen before pagination with id as the equal-time tie-break",
  )
  assert.deepEqual(first.entries[0], {
    entryId: "thread-2",
    parent: AGENT_TASKS_FILE_REF,
    target: resourceFileRef({ scheme: "node", kind: "thread", id: "thread-2" }),
    name: "thread-2",
    kind: "link",
    sortKey: "000000",
    properties: {
      taskId: "thread-2",
      workspaceId: "ws-2",
      status: "running",
      updatedAt: 5,
    },
  })
  assert.deepEqual(Object.keys(first.entries[1]?.properties ?? {}).sort(), [
    "status",
    "taskId",
    "updatedAt",
    "workspaceId",
  ])
  const second = await fs.readDirectory(AGENT_TASKS_FILE_REF, UI_DIRECTORY, {
    limit: 2,
    cursor: first.nextCursor,
  })
  assert.deepEqual(
    second.entries.map((entry) => entry.entryId),
    ["thread-1"],
  )
  assert.equal(second.nextCursor, undefined)

  for (const cursor of ["2", "agent-tasks-v1:bad:01", "agent-tasks-v1:%:2"]) {
    await assert.rejects(
      fs.readDirectory(AGENT_TASKS_FILE_REF, UI_DIRECTORY, { cursor }),
      (error) => error instanceof FileSystemError && error.code === "invalid-input",
    )
  }

  fixture.state.tasks = tasks.map((task, index) =>
    index === 0 ? { ...task, status: "failed", updatedAt: 6 } : task,
  )
  fixture.emit("tasks")
  await assert.rejects(
    fs.readDirectory(AGENT_TASKS_FILE_REF, UI_DIRECTORY, {
      limit: 2,
      cursor: first.nextCursor,
    }),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
})

test("agent config filesystem: workspace projection derives taskCount and follows task versions", async () => {
  const fixture = fakeDeps({
    tasks: [
      {
        id: "thread-1",
        workspaceId: "ws-1",
        status: "active",
        starred: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "thread-2",
        workspaceId: "ws-1",
        status: "done",
        starred: false,
        createdAt: 2,
        updatedAt: 2,
      },
    ],
  })
  const fs = createAgentConfigFileSystem(fixture.deps)
  const ref = AGENT_WORKSPACES_FILE_REF
  const before = await fs.read(ref, UI_CONTENT)
  const beforeWorkspace = (before.data as { workspaces: Array<Record<string, unknown>> })
    .workspaces[0]
  assert.equal(beforeWorkspace?.taskCount, 2)

  const fileEvents: Array<{ fileId: string; version?: string }> = []
  const rootEvents: string[] = []
  const fileWatch = fs.watch?.(ref, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    fileEvents.push({ fileId: event.ref.fileId, version: event.version }),
  )
  const rootWatch = fs.watch?.(
    fs.descriptor.root,
    { actor: "ui", permissions: [], intent: "watch" },
    (event) => rootEvents.push(event.ref.fileId),
  )
  const currentTasks = fixture.state.tasks as Array<Record<string, unknown>>
  fixture.state.tasks = currentTasks.map((task, index) =>
    index === 0 ? { ...task, status: "running", updatedAt: 3 } : task,
  )
  fixture.emit("tasks")

  const after = await fs.read(ref, UI_CONTENT)
  await Promise.all([waitForItems(fileEvents, 1), waitForItems(rootEvents, 2)])
  assert.notEqual(after.version, before.version, "task metadata must invalidate workspace version")
  assert.equal(
    ((after.data as { workspaces: Array<Record<string, unknown>> }).workspaces[0] ?? {}).taskCount,
    2,
  )
  assert.deepEqual(fileEvents, [{ fileId: ref.fileId, version: after.version }])
  assert.deepEqual(rootEvents.sort(), [AGENT_TASKS_FILE_REF.fileId, ref.fileId].sort())
  rootWatch?.dispose()

  const updatedTasks = fixture.state.tasks as Array<Record<string, unknown>>
  fixture.state.tasks = updatedTasks.map((task, index) =>
    index === 0 ? { ...task, starred: true } : task,
  )
  fixture.emit("tasks")
  const afterDerivedOnlyChange = await fs.read(ref, UI_CONTENT)
  await waitForItems(fileEvents, 2)
  assert.notEqual(
    afterDerivedOnlyChange.version,
    after.version,
    "all task snapshot changes must invalidate workspace version even when taskCount is stable",
  )
  assert.deepEqual(fileEvents[1], {
    fileId: ref.fileId,
    version: afterDerivedOnlyChange.version,
  })
  fileWatch?.dispose()
})

test("agent config filesystem: workspace revision invalidates same-content ABA snapshots", async () => {
  const fixture = fakeDeps()
  let writes = 0
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    write(section, value) {
      writes += 1
      return fixture.deps.write(section, value)
    },
  })
  const before = await fs.read(AGENT_WORKSPACES_FILE_REF, UI_CONTENT)

  // 模拟公开文档 A→B→A 或仅 secure key 变化：最终公开正文完全相同，但耐久提交已前进。
  fixture.advanceWorkspaceRevision()
  fixture.advanceWorkspaceRevision()
  const after = await fs.read(AGENT_WORKSPACES_FILE_REF, UI_CONTENT)

  assert.deepEqual(after.data, before.data)
  assert.notEqual(after.version, before.version)
  await assert.rejects(
    fs.write(
      AGENT_WORKSPACES_FILE_REF,
      { data: before.data, expectedVersion: before.version },
      UI_WRITE,
    ),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.equal(writes, 0, "same-content stale CAS must not reach the workspace writer")
})

test("agent config filesystem: workspace writes validate and strip derived taskCount", async () => {
  const fixture = fakeDeps()
  const writes: unknown[] = []
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    write(section, value) {
      writes.push(value)
      return fixture.deps.write(section, value)
    },
  })
  const ref = AGENT_WORKSPACES_FILE_REF
  const current = await fs.read(ref, UI_CONTENT)
  await fs.write(ref, { data: current.data, expectedVersion: current.version }, UI_WRITE)
  const persisted = writes[0] as { workspaces: Array<Record<string, unknown>> }
  assert.equal("taskCount" in (persisted.workspaces[0] ?? {}), false)

  // 成功写会推进 workspace revision；无效输入测试必须使用新的 CAS 基线，确保实际走到 codec。
  const afterWrite = await fs.read(ref, UI_CONTENT)
  const document = afterWrite.data as {
    workspaces: Array<Record<string, unknown>>
    activeId: string
  }
  for (const taskCount of [2, "1"]) {
    await assert.rejects(
      fs.write(
        ref,
        {
          data: {
            ...document,
            workspaces: document.workspaces.map((workspace) => ({ ...workspace, taskCount })),
          },
          expectedVersion: afterWrite.version,
        },
        UI_WRITE,
      ),
      (error) => error instanceof FileSystemError && error.code === "invalid-input",
    )
  }
  assert.equal(writes.length, 1)
})

test("agent config filesystem: management files expose stable semantic identities", async () => {
  const fs = createAgentConfigFileSystem(fakeDeps().deps)
  const expected = [
    {
      section: "settings",
      ref: AGENT_SETTINGS_FILE_REF,
      mediaType: AGENT_SETTINGS_MEDIA_TYPE,
      surface: "settings",
    },
    {
      section: "workspaces",
      ref: AGENT_WORKSPACES_FILE_REF,
      mediaType: AGENT_WORKSPACES_MEDIA_TYPE,
      surface: "spaces",
    },
    {
      section: "tasks",
      ref: AGENT_TASKS_FILE_REF,
      mediaType: AGENT_TASKS_MEDIA_TYPE,
      surface: "tasks",
    },
  ] as const

  for (const item of expected) {
    assert.deepEqual(agentConfigFileRef(item.section), item.ref)
    const file = await fs.stat(item.ref, UI_METADATA)
    assert.ok(file)
    assert.equal(file.kind, "file")
    assert.equal(file.mediaType, item.mediaType)
    assert.equal(file.properties?.configSection, item.section)
    assert.equal(file.properties?.agentManagementSurface, item.surface)
    assert.equal((await fs.read(item.ref, UI_CONTENT)).mediaType, item.mediaType)
  }

  const rules = await fs.stat(agentConfigFileRef("rules"), UI_METADATA)
  assert.equal(rules?.mediaType, "application/json")
  assert.equal(rules?.properties?.agentManagementSurface, undefined)
})

test("agent config filesystem: MCP create action preserves write-only startup parameters", async () => {
  const fixture = fakeDeps()
  const received: Array<Partial<McpServer>> = []
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    createMcpServer(server) {
      received.push(server)
      return {
        id: "mcp-created",
        name: server.name ?? "",
        transport: server.transport ?? "stdio",
        command: server.command ?? "",
        args: server.args ?? "",
        url: server.url ?? "",
        env: server.env ?? [],
        headers: server.headers ?? [],
        auth: server.auth ?? "none",
        enabled: server.enabled ?? true,
        builtin: false,
        createdAt: 10,
        updatedAt: 10,
      }
    },
  })
  const ref = agentConfigFileRef("mcp")
  const input: McpServer = {
    id: "display-placeholder",
    name: "Filesystem MCP",
    transport: "stdio",
    command: "npx",
    args: "-y @modelcontextprotocol/server-filesystem /private/path",
    url: "",
    env: [{ key: "TOKEN", value: "${MCP_TOKEN}" }],
    headers: [],
    auth: "none",
    enabled: true,
    builtin: false,
    createdAt: 1,
    updatedAt: 1,
  }

  assert.ok(
    (await fs.actions(ref, UI_ACTION)).some((action) => action.id === AGENT_MCP_CREATE_ACTION),
  )
  assert.deepEqual(await fs.invoke(ref, AGENT_MCP_CREATE_ACTION, input, UI_ACTION), {
    serverId: "mcp-created",
  })
  assert.equal(received[0]?.args, input.args)
  assert.deepEqual(received[0]?.env, input.env)
  assert.equal(received[0]?.id, undefined, "provider owns the final stable identity")

  await assert.rejects(
    fs.invoke(
      ref,
      AGENT_MCP_CREATE_ACTION,
      { ...input, transport: "loopback", builtin: true },
      UI_ACTION,
    ),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
})

test("agent config filesystem: MCP probe action resolves private config behind the provider boundary", async () => {
  const fixture = fakeDeps()
  const probedIds: string[] = []
  const ref = agentConfigFileRef("mcp")
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    async probeMcpServer(serverId) {
      probedIds.push(serverId)
      return { ok: true, toolCount: 2, tools: ["files.read", "files.write"] }
    },
  })

  assert.ok(
    (await fs.actions(ref, UI_ACTION)).some((action) => action.id === AGENT_MCP_PROBE_ACTION),
  )
  assert.deepEqual(await fs.invoke(ref, AGENT_MCP_PROBE_ACTION, { serverId: "mcp-1" }, UI_ACTION), {
    ok: true,
    toolCount: 2,
    tools: ["files.read", "files.write"],
  })
  assert.deepEqual(probedIds, ["mcp-1"])

  for (const input of [undefined, {}, { serverId: "" }, { serverId: "mcp-1", extra: true }]) {
    await assert.rejects(
      fs.invoke(ref, AGENT_MCP_PROBE_ACTION, input, UI_ACTION),
      (error) => error instanceof FileSystemError && error.code === "invalid-input",
    )
  }
  await assert.rejects(
    fs.invoke(
      ref,
      AGENT_MCP_PROBE_ACTION,
      { serverId: "mcp-1" },
      {
        actor: "agent",
        permissions: ["agent.config:read"],
        intent: "action",
      },
    ),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )

  const missing = createAgentConfigFileSystem({
    ...fixture.deps,
    probeMcpServer: async () => null,
  })
  await assert.rejects(
    missing.invoke(ref, AGENT_MCP_PROBE_ACTION, { serverId: "missing" }, UI_ACTION),
    (error) => error instanceof FileSystemError && error.code === "not-found",
  )

  const unsafe = createAgentConfigFileSystem({
    ...fixture.deps,
    probeMcpServer: async () => {
      throw new Error("failed with --token private-probe-secret")
    },
  })
  let caught: unknown
  try {
    await unsafe.invoke(ref, AGENT_MCP_PROBE_ACTION, { serverId: "mcp-1" }, UI_ACTION)
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof FileSystemError)
  assert.equal(caught.code, "unavailable")
  assert.equal(String(caught).includes("private-probe-secret"), false)

  const unsafeResult = createAgentConfigFileSystem({
    ...fixture.deps,
    probeMcpServer: async () => ({
      ok: false,
      error: "spawn failed: npx --token private-result-secret",
    }),
  })
  const safeResult = await unsafeResult.invoke(
    ref,
    AGENT_MCP_PROBE_ACTION,
    { serverId: "mcp-1" },
    UI_ACTION,
  )
  assert.deepEqual(safeResult, {
    ok: false,
    error: "连接失败，请检查本机配置和服务状态",
  })
  assert.equal(JSON.stringify(safeResult).includes("private-result-secret"), false)

  const classified = createAgentConfigFileSystem({
    ...fixture.deps,
    probeMcpServer: async () => ({
      ok: false,
      transport: "stdio",
      checkedAt: 100,
      durationMs: 25,
      error: "raw text must not decide the public message",
      errorKind: "unavailable",
      errorCode: "service-unavailable",
    }),
  })
  assert.deepEqual(
    await classified.invoke(ref, AGENT_MCP_PROBE_ACTION, { serverId: "mcp-1" }, UI_ACTION),
    {
      ok: false,
      transport: "stdio",
      checkedAt: 100,
      durationMs: 25,
      error: "无法启动或连接本地 MCP 服务",
      errorKind: "unavailable",
      errorCode: "service-unavailable",
    },
  )

  const mismatchedClassification = createAgentConfigFileSystem({
    ...fixture.deps,
    probeMcpServer: async () => ({
      ok: false,
      error: "private",
      errorKind: "authentication",
      errorCode: "service-unavailable",
    }),
  })
  await assert.rejects(
    mismatchedClassification.invoke(ref, AGENT_MCP_PROBE_ACTION, { serverId: "mcp-1" }, UI_ACTION),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
})

test("agent config filesystem: mutating actions validate fresh section versions before backends", async () => {
  const fixture = fakeDeps(undefined, "")
  const calls = {
    setCredential: 0,
    clearCredential: 0,
    createWorkspace: 0,
    activateWorkspace: 0,
    createMcp: 0,
  }
  let mutateWorkspaceDuringPrepare = false
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    prepare(section) {
      if (section !== "workspaces" || !mutateWorkspaceDuringPrepare) return
      mutateWorkspaceDuringPrepare = false
      const current = fixture.state.workspaces as {
        workspaces: Array<Record<string, unknown>>
        activeId: string
      }
      fixture.state.workspaces = {
        ...current,
        workspaces: current.workspaces.map((workspace) => ({ ...workspace, name: "External" })),
      }
    },
    writeSettingsApiKey() {
      calls.setCredential += 1
    },
    deleteSettingsApiKey() {
      calls.clearCredential += 1
    },
    createWorkspace(name) {
      calls.createWorkspace += 1
      return { workspaceId: "ws-created", name: name ?? "Created" }
    },
    activateWorkspace(workspaceId) {
      calls.activateWorkspace += 1
      return { workspaceId }
    },
    createMcpServer(server) {
      calls.createMcp += 1
      return {
        id: "mcp-created",
        name: server.name ?? "Created",
        transport: server.transport ?? "stdio",
        command: server.command ?? "",
        args: server.args ?? "",
        url: server.url ?? "",
        env: server.env ?? [],
        headers: server.headers ?? [],
        auth: server.auth ?? "none",
        enabled: server.enabled ?? true,
        builtin: false,
        createdAt: 2,
        updatedAt: 2,
      }
    },
  })
  const settingsRef = agentConfigFileRef("settings")
  const workspacesRef = agentConfigFileRef("workspaces")
  const mcpRef = agentConfigFileRef("mcp")
  const settingsVersion = (await fs.read(settingsRef, UI_CONTENT)).version
  const workspacesVersion = (await fs.read(workspacesRef, UI_CONTENT)).version
  const mcpVersion = (await fs.read(mcpRef, UI_CONTENT)).version
  assert.ok(settingsVersion)
  assert.ok(workspacesVersion)
  assert.ok(mcpVersion)

  fixture.state.settings = { ...(fixture.state.settings as object), model: "external-model" }
  mutateWorkspaceDuringPrepare = true
  fixture.state.mcp = (fixture.state.mcp as Array<Record<string, unknown>>).map((server) => ({
    ...server,
    name: "External MCP",
  }))

  const mcpInput = (fixture.state.mcp as McpServer[])[0]
  assert.ok(mcpInput)
  const staleMutations = [
    () =>
      fs.invoke(settingsRef, AGENT_SETTINGS_SET_API_KEY_ACTION, { apiKey: "sk-stale" }, UI_ACTION, {
        expectedVersion: settingsVersion,
      }),
    () =>
      fs.invoke(settingsRef, AGENT_SETTINGS_CLEAR_API_KEY_ACTION, undefined, UI_ACTION, {
        expectedVersion: settingsVersion,
      }),
    () =>
      fs.invoke(workspacesRef, AGENT_WORKSPACE_CREATE_ACTION, undefined, UI_ACTION, {
        expectedVersion: workspacesVersion,
      }),
    () =>
      fs.invoke(
        workspacesRef,
        AGENT_WORKSPACE_ACTIVATE_ACTION,
        { workspaceId: "ws-1" },
        UI_ACTION,
        { expectedVersion: workspacesVersion },
      ),
    () =>
      fs.invoke(mcpRef, AGENT_MCP_CREATE_ACTION, mcpInput, UI_ACTION, {
        expectedVersion: mcpVersion,
      }),
  ]
  for (const mutation of staleMutations) {
    await assert.rejects(
      mutation(),
      (error) => error instanceof FileSystemError && error.code === "conflict",
    )
  }
  await assert.rejects(
    fs.invoke(workspacesRef, AGENT_WORKSPACE_CREATE_ACTION, undefined, UI_ACTION, {
      expectedVersion: null,
    }),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.deepEqual(calls, {
    setCredential: 0,
    clearCredential: 0,
    createWorkspace: 0,
    activateWorkspace: 0,
    createMcp: 0,
  })

  const currentSettingsVersion = (await fs.read(settingsRef, UI_CONTENT)).version
  assert.ok(currentSettingsVersion)
  assert.deepEqual(
    await fs.invoke(
      settingsRef,
      AGENT_SETTINGS_SET_API_KEY_ACTION,
      { apiKey: "sk-current" },
      UI_ACTION,
      { expectedVersion: currentSettingsVersion },
    ),
    { configured: true },
  )
  assert.deepEqual(
    await fs.invoke(workspacesRef, AGENT_WORKSPACE_CREATE_ACTION, undefined, UI_ACTION, {
      expectedVersion: undefined,
    }),
    { workspaceId: "ws-created", name: "Created" },
  )
  assert.equal(calls.setCredential, 1)
  assert.equal(calls.createWorkspace, 1)
})

test("agent config filesystem: workspace CAS holds its tasks dependency lock through commit", async () => {
  const fixture = fakeDeps()
  const workspaceCommitStarted = deferred()
  const releaseWorkspaceCommit = deferred()
  let taskWrites = 0
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    write(section, value) {
      if (section === "tasks") taskWrites += 1
      return fixture.deps.write(section, value)
    },
    async createWorkspace(name) {
      workspaceCommitStarted.resolve()
      await releaseWorkspaceCommit.promise
      return { workspaceId: "ws-locked", name: name ?? "Locked" }
    },
  })
  const workspacesRef = agentConfigFileRef("workspaces")
  const tasksRef = agentConfigFileRef("tasks")
  const workspacesVersion = (await fs.read(workspacesRef, UI_CONTENT)).version
  const tasksSnapshot = await fs.read(tasksRef, UI_CONTENT)

  const workspaceCommit = fs.invoke(
    workspacesRef,
    AGENT_WORKSPACE_CREATE_ACTION,
    undefined,
    UI_ACTION,
    { expectedVersion: workspacesVersion },
  )
  await workspaceCommitStarted.promise
  let taskWriteSettled = false
  const taskWrite = fs
    .write(tasksRef, { data: tasksSnapshot.data, expectedVersion: tasksSnapshot.version }, UI_WRITE)
    .then(() => {
      taskWriteSettled = true
    })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(taskWriteSettled, false)
  assert.equal(taskWrites, 0)

  releaseWorkspaceCommit.resolve()
  assert.deepEqual(await workspaceCommit, { workspaceId: "ws-locked", name: "Locked" })
  await taskWrite
  assert.equal(taskWrites, 1)
})

test("agent config filesystem: queued workspace CAS observes a completed tasks dependency commit", async () => {
  const fixture = fakeDeps()
  const taskCommitStarted = deferred()
  const releaseTaskCommit = deferred()
  let workspaceCommits = 0
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    async write(section, value) {
      if (section === "tasks") {
        taskCommitStarted.resolve()
        await releaseTaskCommit.promise
      }
      await fixture.deps.write(section, value)
    },
    createWorkspace() {
      workspaceCommits += 1
      return { workspaceId: "ws-unexpected", name: "Unexpected" }
    },
  })
  const workspacesRef = agentConfigFileRef("workspaces")
  const tasksRef = agentConfigFileRef("tasks")
  const staleWorkspaceVersion = (await fs.read(workspacesRef, UI_CONTENT)).version
  const tasksSnapshot = await fs.read(tasksRef, UI_CONTENT)
  const changedTasks = (tasksSnapshot.data as Array<Record<string, unknown>>).map((task) => ({
    ...task,
    status: "done",
    updatedAt: 2,
  }))

  const taskCommit = fs.write(
    tasksRef,
    { data: changedTasks, expectedVersion: tasksSnapshot.version },
    UI_WRITE,
  )
  await taskCommitStarted.promise
  const workspaceCommit = fs.invoke(
    workspacesRef,
    AGENT_WORKSPACE_CREATE_ACTION,
    undefined,
    UI_ACTION,
    { expectedVersion: staleWorkspaceVersion },
  )
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(workspaceCommits, 0)

  releaseTaskCommit.resolve()
  await taskCommit
  await assert.rejects(
    workspaceCommit,
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.equal(workspaceCommits, 0)
})

test("agent config filesystem: read-only and external probe actions do not invent CAS reads", async () => {
  const fixture = fakeDeps()
  let reads = 0
  let prepares = 0
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    read(section) {
      reads += 1
      return fixture.deps.read(section)
    },
    prepare() {
      prepares += 1
    },
    probeMcpServer: async () => ({ ok: true, toolCount: 0 }),
  })
  const settingsRef = agentConfigFileRef("settings")
  const mcpRef = agentConfigFileRef("mcp")

  assert.deepEqual(
    await fs.invoke(settingsRef, "open", undefined, UI_ACTION, {
      expectedVersion: "stale",
    }),
    { ref: settingsRef },
  )
  assert.deepEqual(
    await fs.invoke(settingsRef, AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION, undefined, UI_ACTION, {
      expectedVersion: null,
    }),
    { configured: true },
  )
  assert.deepEqual(
    await fs.invoke(mcpRef, AGENT_MCP_PROBE_ACTION, { serverId: "mcp-1" }, UI_ACTION, {
      expectedVersion: "stale",
    }),
    { ok: true, toolCount: 0 },
  )
  assert.equal(reads, 0)
  assert.equal(prepares, 0)
})

test("agent config filesystem: skills.json is writable and emits file/root watch events", async () => {
  const fixture = fakeDeps()
  const fs = createAgentConfigFileSystem(fixture.deps)
  const ref = agentConfigFileRef("skills")
  const fileEvents: string[] = []
  const rootEvents: string[] = []
  fs.watch?.(ref, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    fileEvents.push(event.ref.fileId),
  )
  fs.watch?.(fs.descriptor.root, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    rootEvents.push(event.ref.fileId),
  )

  await fs.write(
    ref,
    {
      data: [{ id: "skill-2", label: "新技能", hint: "new", prompt: "run" }],
      mediaType: "application/json",
    },
    UI_WRITE,
  )

  await Promise.all([waitForItems(fileEvents, 1), waitForItems(rootEvents, 1)])
  assert.deepEqual(fixture.state.skills, [
    { id: "skill-2", label: "新技能", hint: "new", prompt: "run" },
  ])
  assert.deepEqual(fileEvents, [ref.fileId])
  assert.deepEqual(rootEvents, [ref.fileId])
})

test("agent config filesystem: metadata and reads never expose API keys or MCP tokens", async () => {
  const fs = createAgentConfigFileSystem(fakeDeps().deps)
  const refs = [
    agentConfigFileRef("settings"),
    agentConfigFileRef("workspaces"),
    agentConfigFileRef("mcp"),
  ]

  for (const ref of refs) {
    const metadata = await fs.stat(ref, UI_METADATA)
    const json = await fs.read(ref, UI_CONTENT)
    const text = await fs.read(ref, UI_CONTENT, { encoding: "text" })
    const exposed = `${JSON.stringify(metadata)}\n${JSON.stringify(json.data)}\n${text.data}`
    for (const secret of [
      "sk-never-expose",
      "settings-token",
      "ws-secret",
      "password",
      "url-secret",
      "env-secret",
      "header-secret",
      "cli-secret",
    ]) {
      assert.equal(exposed.includes(secret), false, `${ref.fileId} leaked ${secret}`)
    }
  }

  const mcp = (await fs.read(agentConfigFileRef("mcp"), UI_CONTENT)).data as Array<{
    args: string
    env: Array<{ key: string; value: string }>
    headers: Array<{ key: string; value: string }>
    url: string
  }>
  assert.equal(mcp[0].env[0].value, "")
  assert.equal(mcp[0].env[1].value, "")
  assert.equal(mcp[0].headers[0].value, "")
  assert.equal(mcp[0].headers[1].value, "")
  assert.equal(new URL(mcp[0].url).searchParams.get("access_token"), "")
  assert.equal(mcp[0].args.includes("cli-secret"), false)
})

test("agent config filesystem: malformed backing stores fail closed instead of echoing raw values", async () => {
  const malicious: Record<AgentPublicConfigSectionId, unknown> = {
    settings: "settings-raw-secret",
    workspaces: { activeId: "", privateValue: "workspace-raw-secret" },
    rules: [{ id: "bad-rule", privateValue: "rules-raw-secret" }],
    skills: [{ id: "bad-skill", privateValue: "skills-raw-secret" }],
    mcp: "mcp-raw-secret",
    tasks: [{ id: "bad-task", privateValue: "tasks-raw-secret" }],
  }
  const fs = createAgentConfigFileSystem({
    read: (section) => malicious[section],
    write: () => undefined,
    subscribe: () => () => undefined,
  })

  for (const section of Object.keys(malicious) as AgentPublicConfigSectionId[]) {
    const json = await fs.read(agentConfigFileRef(section), UI_CONTENT)
    const text = await fs.read(agentConfigFileRef(section), UI_CONTENT, { encoding: "text" })
    const exposed = `${JSON.stringify(json.data)}\n${text.data}`
    assert.equal(exposed.includes("raw-secret"), false, `${section} echoed malformed backing data`)
  }
})

test("agent config filesystem: JSON writes enforce versions, strip secrets and notify watches", async () => {
  const fixture = fakeDeps()
  const fs = createAgentConfigFileSystem(fixture.deps)
  const ref = agentConfigFileRef("settings")
  const before = await fs.read(ref, UI_CONTENT, { encoding: "text" })
  const fileEvents: string[] = []
  const rootEvents: string[] = []
  const fileWatch = fs.watch?.(ref, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    fileEvents.push(event.ref.fileId),
  )
  const rootWatch = fs.watch?.(
    fs.descriptor.root,
    { actor: "ui", permissions: [], intent: "watch" },
    (event) => rootEvents.push(event.ref.fileId),
  )

  const updated = await fs.write(
    ref,
    {
      data: JSON.stringify({
        baseURL: "https://new.example.test/v1",
        model: "new-model",
        apiKey: "write-secret",
        includeHomeContext: false,
        defaultAgentMode: false,
        approvalPolicy: "auto",
      }),
      mediaType: "application/json",
      expectedVersion: before.version,
    },
    UI_WRITE,
  )
  await Promise.all([waitForItems(fileEvents, 1), waitForItems(rootEvents, 1)])
  assert.equal(JSON.stringify(fixture.state.settings).includes("write-secret"), false)
  assert.equal((fixture.state.settings as { model: string }).model, "new-model")
  assert.notEqual(updated.version, before.version)
  assert.deepEqual(fileEvents, [ref.fileId])
  assert.deepEqual(rootEvents, [ref.fileId])

  await assert.rejects(
    fs.write(
      ref,
      { data: "{}", mediaType: "application/json", expectedVersion: before.version },
      UI_WRITE,
    ),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )

  fileWatch?.dispose()
  rootWatch?.dispose()
  fixture.emit("settings")
  assert.equal(fileEvents.length, 1)
  assert.equal(rootEvents.length, 1)
})

test("agent config filesystem: credential actions are discoverable, permissioned and secret-safe", async () => {
  const fixture = fakeDeps(undefined, "")
  const fs = createAgentConfigFileSystem(fixture.deps)
  const ref = agentConfigFileRef("settings")
  const actions = await fs.actions(ref, UI_ACTION)
  const byId = new Map(actions.map((action) => [action.id, action]))

  assert.deepEqual(
    actions.map((action) => action.id),
    [
      "open",
      AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION,
      AGENT_SETTINGS_SET_API_KEY_ACTION,
      AGENT_SETTINGS_CLEAR_API_KEY_ACTION,
      AGENT_SETTINGS_ACP_READ_ACTION,
      AGENT_SETTINGS_ACP_WRITE_ACTION,
      AGENT_SETTINGS_ACP_DETECT_ACTION,
      AGENT_SETTINGS_ACP_PROBE_ACTION,
    ],
  )
  assert.deepEqual(byId.get(AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION)?.requires, [
    "agent.config:read",
  ])
  assert.deepEqual(byId.get(AGENT_SETTINGS_SET_API_KEY_ACTION)?.requires, ["agent.config:write"])
  assert.deepEqual(byId.get(AGENT_SETTINGS_CLEAR_API_KEY_ACTION)?.requires, ["agent.config:write"])
  assert.deepEqual(byId.get(AGENT_SETTINGS_ACP_READ_ACTION)?.requires, ["agent.config:read"])
  assert.deepEqual(byId.get(AGENT_SETTINGS_ACP_WRITE_ACTION)?.requires, ["agent.config:write"])

  await assert.rejects(
    fs.invoke(ref, AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION, undefined, {
      actor: "agent",
      permissions: ["fs:read"],
      intent: "action",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  assert.deepEqual(
    await fs.invoke(ref, AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION, undefined, {
      actor: "agent",
      permissions: ["agent.config:read"],
      intent: "action",
    }),
    { configured: false },
  )
  await assert.rejects(
    fs.invoke(
      ref,
      AGENT_SETTINGS_SET_API_KEY_ACTION,
      { apiKey: "sk-denied" },
      {
        actor: "agent",
        permissions: ["fs:write"],
        intent: "action",
      },
    ),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  await assert.rejects(
    fs.invoke(
      ref,
      AGENT_SETTINGS_SET_API_KEY_ACTION,
      { apiKey: "sk-wrong-file" },
      {
        actor: "engine",
        permissions: [],
        activeFile: agentConfigFileRef("workspaces"),
        intent: "action",
      },
    ),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )

  const before = await fs.read(ref, UI_CONTENT)
  const events: Array<{ version?: string }> = []
  const handle = fs.watch?.(ref, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    events.push({ version: event.version }),
  )
  const secret = "sk-action-must-never-echo"
  const setResult = await fs.invoke(
    ref,
    AGENT_SETTINGS_SET_API_KEY_ACTION,
    { apiKey: secret },
    {
      actor: "engine",
      permissions: [],
      activeFile: ref,
      intent: "action",
    },
  )
  assert.deepEqual(setResult, { configured: true })
  assert.equal(fixture.credential(), secret)
  await waitForItems(events, 1)
  assert.equal(events.length, 1)

  const afterSet = await fs.read(ref, UI_CONTENT)
  const metadata = await fs.stat(ref, UI_METADATA)
  const exposed = JSON.stringify({ setResult, data: afterSet.data, metadata, events })
  assert.equal(exposed.includes(secret), false)
  assert.equal(exposed.includes("configured"), true)
  assert.equal(afterSet.version === before.version, false)
  assert.equal(afterSet.version?.includes("configured"), false)
  assert.equal(afterSet.version?.includes("empty"), false)

  assert.deepEqual(
    await fs.invoke(ref, AGENT_SETTINGS_CLEAR_API_KEY_ACTION, undefined, UI_ACTION),
    { configured: false },
  )
  assert.equal(fixture.credential(), "")
  await waitForItems(events, 2)
  assert.equal(events.length, 2)
  const afterClear = await fs.read(ref, UI_CONTENT)
  assert.notEqual(afterClear.version, afterSet.version)
  assert.notEqual(afterClear.version, before.version)
  handle?.dispose()
})

test("agent config filesystem: credential revision rejects a second re-key from the same version", async () => {
  const fixture = fakeDeps(undefined, "sk-A")
  const originalWrite = fixture.deps.writeSettingsApiKey
  let backendWrites = 0
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    async writeSettingsApiKey(apiKey) {
      backendWrites += 1
      await originalWrite?.(apiKey)
    },
  })
  const ref = agentConfigFileRef("settings")
  const expectedVersion = (await fs.read(ref, UI_CONTENT)).version
  assert.ok(expectedVersion)

  const first = fs.invoke(ref, AGENT_SETTINGS_SET_API_KEY_ACTION, { apiKey: "sk-B" }, UI_ACTION, {
    expectedVersion,
  })
  const second = fs.invoke(ref, AGENT_SETTINGS_SET_API_KEY_ACTION, { apiKey: "sk-C" }, UI_ACTION, {
    expectedVersion,
  })
  const [firstResult, secondResult] = await Promise.allSettled([first, second])

  assert.equal(firstResult.status, "fulfilled")
  assert.equal(secondResult.status, "rejected")
  assert.ok(secondResult.reason instanceof FileSystemError)
  assert.equal(secondResult.reason.code, "conflict")
  assert.equal(backendWrites, 1)
  assert.equal(fixture.credential(), "sk-B")
  assert.equal(fixture.credentialRevision(), "1")
  assert.notEqual((await fs.read(ref, UI_CONTENT)).version, expectedVersion)
})

test("agent config filesystem: credential actions reject malformed input and redact backend errors", async () => {
  const fixture = fakeDeps(undefined, "")
  const ref = agentConfigFileRef("settings")
  const fs = createAgentConfigFileSystem(fixture.deps)
  const invalidSetInputs = [
    undefined,
    null,
    {},
    { apiKey: "" },
    { apiKey: " key " },
    { apiKey: 42 },
    { apiKey: "key", extra: true },
    { apiKey: "x".repeat(MAX_AGENT_SETTINGS_API_KEY_LENGTH + 1) },
  ]
  for (const input of invalidSetInputs) {
    await assert.rejects(
      fs.invoke(ref, AGENT_SETTINGS_SET_API_KEY_ACTION, input, UI_ACTION),
      (error) => error instanceof FileSystemError && error.code === "invalid-input",
    )
  }
  for (const action of [
    AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION,
    AGENT_SETTINGS_CLEAR_API_KEY_ACTION,
  ]) {
    await assert.rejects(
      fs.invoke(ref, action, {}, UI_ACTION),
      (error) => error instanceof FileSystemError && error.code === "invalid-input",
    )
  }

  const secret = "sk-backend-echo-attempt"
  const unsafe = createAgentConfigFileSystem({
    ...fixture.deps,
    async writeSettingsApiKey() {
      throw new Error(`backend failed for ${secret}`)
    },
  })
  let caught: unknown
  try {
    await unsafe.invoke(ref, AGENT_SETTINGS_SET_API_KEY_ACTION, { apiKey: secret }, UI_ACTION)
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof FileSystemError)
  assert.equal(caught.code, "offline")
  assert.equal(String(caught).includes(secret), false)
  assert.equal(JSON.stringify(caught).includes(secret), false)
})

test("agent config filesystem: credential status is serialized behind durable mutations", async () => {
  const fixture = fakeDeps(undefined, "")
  const started = deferred()
  const release = deferred()
  let credential = ""
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    settingsCredentialConfigured: () => Boolean(credential),
    readSettingsCredentialConfigured: async () => Boolean(credential),
    async writeSettingsApiKey(apiKey) {
      started.resolve()
      await release.promise
      credential = apiKey
      fixture.emit("settings")
    },
  })
  const ref = agentConfigFileRef("settings")
  const events: string[] = []
  fs.watch?.(ref, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    events.push(event.ref.fileId),
  )

  const setPending = fs.invoke(
    ref,
    AGENT_SETTINGS_SET_API_KEY_ACTION,
    { apiKey: "sk-serialized" },
    UI_ACTION,
  )
  await started.promise
  let statusResolved = false
  const statusPending = fs
    .invoke(ref, AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION, undefined, UI_ACTION)
    .then((result) => {
      statusResolved = true
      return result
    })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(statusResolved, false)
  assert.deepEqual(events, [])

  release.resolve()
  assert.deepEqual(await setPending, { configured: true })
  assert.deepEqual(await statusPending, { configured: true })
  await waitForItems(events, 1)
  assert.deepEqual(events, [ref.fileId])
})

test("agent config filesystem: workspace actions reuse strict contracts and notify versions", async () => {
  const fixture = fakeDeps()
  const fs = createAgentConfigFileSystem(fixture.deps)
  const ref = agentConfigFileRef("workspaces")
  const actions = await fs.actions(ref, UI_ACTION)
  assert.deepEqual(
    actions.map((action) => action.id),
    ["open", AGENT_WORKSPACE_CREATE_ACTION, AGENT_WORKSPACE_ACTIVATE_ACTION],
  )
  assert.deepEqual(
    actions.slice(1).map((action) => action.requires),
    [["agent.config:write"], ["agent.config:write"]],
  )

  await assert.rejects(
    fs.invoke(ref, AGENT_WORKSPACE_CREATE_ACTION, undefined, {
      actor: "agent",
      permissions: ["fs:write"],
      intent: "action",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  await assert.rejects(
    fs.invoke(ref, AGENT_WORKSPACE_CREATE_ACTION, undefined, {
      actor: "engine",
      permissions: [],
      activeFile: agentConfigFileRef("settings"),
      intent: "action",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )

  const before = await fs.read(ref, UI_CONTENT)
  const versions: Array<string | undefined> = []
  fs.watch?.(ref, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    versions.push(event.version),
  )
  const created = await fs.invoke(
    ref,
    AGENT_WORKSPACE_CREATE_ACTION,
    { name: "研究" },
    {
      actor: "agent",
      permissions: ["agent.config:write"],
      intent: "action",
    },
  )
  assert.deepEqual(created, { workspaceId: "ws-2", name: "研究" })
  const afterCreate = await fs.read(ref, UI_CONTENT)
  assert.notEqual(afterCreate.version, before.version)
  await waitForItems(versions, 1)
  assert.equal(versions.length, 1)

  const activated = await fs.invoke(
    ref,
    AGENT_WORKSPACE_ACTIVATE_ACTION,
    { workspaceId: "ws-2" },
    { actor: "engine", permissions: [], activeFile: ref, intent: "action" },
  )
  assert.deepEqual(activated, { workspaceId: "ws-2" })
  await waitForItems(versions, 2)
  assert.equal(versions.length, 2)
  assert.equal(((await fs.read(ref, UI_CONTENT)).data as { activeId: string }).activeId, "ws-2")

  for (const input of [
    null,
    { name: "" },
    { name: 42 },
    { name: "研究", extra: true },
    { name: "x".repeat(MAX_AGENT_MANAGEMENT_STRING_LENGTH + 1) },
  ]) {
    await assert.rejects(
      fs.invoke(ref, AGENT_WORKSPACE_CREATE_ACTION, input, UI_ACTION),
      (error) => error instanceof FileSystemError && error.code === "invalid-input",
    )
  }
  for (const input of [
    undefined,
    {},
    { workspaceId: "" },
    { workspaceId: 42 },
    { workspaceId: "ws-1", extra: true },
    { workspaceId: "x".repeat(MAX_AGENT_MANAGEMENT_STRING_LENGTH + 1) },
  ]) {
    await assert.rejects(
      fs.invoke(ref, AGENT_WORKSPACE_ACTIVATE_ACTION, input, UI_ACTION),
      (error) => error instanceof FileSystemError && error.code === "invalid-input",
    )
  }
  await assert.rejects(
    fs.invoke(ref, AGENT_WORKSPACE_ACTIVATE_ACTION, { workspaceId: "missing" }, UI_ACTION),
    (error) => error instanceof FileSystemError && error.code === "not-found",
  )
})

test("agent config filesystem: workspace action results and failures cannot echo provider secrets", async () => {
  const fixture = fakeDeps()
  const ref = agentConfigFileRef("workspaces")
  const secret = "workspace-provider-secret"
  const unsafeCreate = createAgentConfigFileSystem({
    ...fixture.deps,
    createWorkspace: () =>
      ({ workspaceId: "ws-unsafe", name: "Unsafe", apiKey: secret }) as AgentWorkspaceCreateResult,
  })
  let createError: unknown
  try {
    await unsafeCreate.invoke(ref, AGENT_WORKSPACE_CREATE_ACTION, undefined, UI_ACTION)
  } catch (error) {
    createError = error
  }
  assert.ok(createError instanceof FileSystemError)
  assert.equal(createError.code, "unavailable")
  assert.equal(String(createError).includes(secret), false)

  const unsafeActivate = createAgentConfigFileSystem({
    ...fixture.deps,
    activateWorkspace: () =>
      ({ workspaceId: "different", detail: secret }) as { workspaceId: string },
  })
  let activateError: unknown
  try {
    await unsafeActivate.invoke(
      ref,
      AGENT_WORKSPACE_ACTIVATE_ACTION,
      { workspaceId: "ws-1" },
      UI_ACTION,
    )
  } catch (error) {
    activateError = error
  }
  assert.ok(activateError instanceof FileSystemError)
  assert.equal(activateError.code, "unavailable")
  assert.equal(String(activateError).includes(secret), false)
})

test("agent config filesystem: active engine is scoped and generic fs:write cannot edit config", async () => {
  const fs = createAgentConfigFileSystem(fakeDeps().deps)
  const settingsRef = agentConfigFileRef("settings")
  const rulesRef = agentConfigFileRef("rules")

  await fs.read(settingsRef, {
    actor: "engine",
    permissions: [],
    activeFile: settingsRef,
    intent: "content",
  })
  await assert.rejects(
    fs.read(rulesRef, {
      actor: "engine",
      permissions: [],
      activeFile: settingsRef,
      intent: "content",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  await fs.write(
    settingsRef,
    { data: "{}" },
    { actor: "engine", permissions: [], activeFile: settingsRef, intent: "write" },
  )
  await assert.rejects(
    fs.write(
      settingsRef,
      { data: "{}" },
      { actor: "agent", permissions: ["fs:read", "fs:write"], intent: "write" },
    ),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )

  await fs.write(
    settingsRef,
    { data: "{}" },
    { actor: "system", permissions: ["agent.config:write"], intent: "write" },
  )
})

test("agent config filesystem: generic fs:read sees metadata only; content and watch need dedicated consent", async () => {
  const fixture = fakeDeps()
  const fs = createAgentConfigFileSystem(fixture.deps)
  const rulesRef = agentConfigFileRef("rules")
  const genericRead = { actor: "agent", permissions: ["fs:read"], intent: "metadata" } as const

  const genericMetadata = await fs.stat(rulesRef, genericRead)
  assert.ok(genericMetadata)
  assert.equal(genericMetadata.size, undefined)
  assert.equal(genericMetadata.version, undefined)
  const consentedMetadata = await fs.stat(rulesRef, {
    actor: "agent",
    permissions: ["fs:read", "agent.config:read"],
    intent: "metadata",
  })
  assert.equal(typeof consentedMetadata?.size, "number")
  assert.equal(typeof consentedMetadata?.version, "string")
  assert.equal(
    (
      await fs.readDirectory(fs.descriptor.root, {
        actor: "agent",
        permissions: ["fs:read"],
        intent: "directory",
      })
    ).entries.length,
    6,
  )
  await assert.rejects(
    fs.read(rulesRef, {
      actor: "agent",
      permissions: ["fs:read"],
      intent: "content",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  assert.throws(
    () =>
      fs.watch?.(
        rulesRef,
        { actor: "agent", permissions: ["fs:read"], intent: "watch" },
        () => undefined,
      ),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )

  const read = await fs.read(rulesRef, {
    actor: "agent",
    permissions: ["agent.config:read"],
    intent: "content",
  })
  assert.deepEqual(read.data, fixture.state.rules)
  const events: string[] = []
  const handle = fs.watch?.(
    rulesRef,
    { actor: "agent", permissions: ["agent.config:read"], intent: "watch" },
    (event) => events.push(event.ref.fileId),
  )
  fixture.emit("rules")
  await waitForItems(events, 1)
  assert.deepEqual(events, [rulesRef.fileId])
  handle?.dispose()
})

test("agent config filesystem: versioned watches capture consecutive snapshots in source order", async () => {
  const fixture = fakeDeps()
  const fs = createAgentConfigFileSystem(fixture.deps)
  const ref = agentConfigFileRef("rules")
  const original = fixture.state.rules
  const firstValue = (original as Array<Record<string, unknown>>).map((rule) => ({
    ...rule,
    body: "first",
    updatedAt: 2,
  }))
  const secondValue = firstValue.map((rule) => ({ ...rule, body: "second", updatedAt: 3 }))
  fixture.state.rules = firstValue
  const firstVersion = (await fs.read(ref, UI_CONTENT)).version
  fixture.state.rules = secondValue
  const secondVersion = (await fs.read(ref, UI_CONTENT)).version
  fixture.state.rules = original

  const versions: Array<string | undefined> = []
  const handle = fs.watch?.(ref, UI_WATCH, (event) => versions.push(event.version))
  fixture.state.rules = firstValue
  fixture.emit("rules")
  fixture.state.rules = secondValue
  fixture.emit("rules")

  await waitForItems(versions, 2)
  assert.deepEqual(versions, [firstVersion, secondVersion])
  handle?.dispose()
})

test("agent config filesystem: dispose suppresses a pending version digest", async () => {
  const fixture = fakeDeps()
  const fs = createAgentConfigFileSystem(fixture.deps)
  const ref = agentConfigFileRef("rules")
  const events: Array<string | undefined> = []
  const handle = fs.watch?.(ref, UI_WATCH, (event) => events.push(event.version))

  fixture.emit("rules")
  handle?.dispose()
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(events, [])
})

test("agent config filesystem: a root Engine watch cannot fingerprint child content versions", async () => {
  const fixture = fakeDeps()
  const fs = createAgentConfigFileSystem(fixture.deps)
  const rootEvents: Array<{ fileId: string; version?: string }> = []
  const consentedEvents: Array<{ fileId: string; version?: string }> = []
  const engineWatch = fs.watch?.(
    fs.descriptor.root,
    {
      actor: "engine",
      permissions: [],
      activeFile: fs.descriptor.root,
      intent: "watch",
    },
    (event) => rootEvents.push({ fileId: event.ref.fileId, version: event.version }),
  )
  const consentedWatch = fs.watch?.(
    fs.descriptor.root,
    { actor: "agent", permissions: ["agent.config:read"], intent: "watch" },
    (event) => consentedEvents.push({ fileId: event.ref.fileId, version: event.version }),
  )

  fixture.emit("rules")
  assert.deepEqual(rootEvents, [{ fileId: "config:rules", version: undefined }])
  await waitForItems(consentedEvents, 1)
  assert.equal(consentedEvents[0]?.fileId, "config:rules")
  assert.equal(typeof consentedEvents[0]?.version, "string")
  engineWatch?.dispose()
  consentedWatch?.dispose()
})

test("agent config filesystem: a partial root watch failure rolls back every established section", async () => {
  const fixture = fakeDeps()
  const active = new Set<AgentPublicConfigSectionId>()
  const disposed: AgentPublicConfigSectionId[] = []
  const events: string[] = []
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    subscribe(section, listener) {
      if (section === "rules") throw new Error("rules subscription unavailable")
      active.add(section)
      const upstream = fixture.deps.subscribe(section, listener)
      if (section === "settings") listener()
      return () => {
        upstream()
        active.delete(section)
        disposed.push(section)
      }
    },
  })

  assert.throws(
    () =>
      fs.watch?.(fs.descriptor.root, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
        events.push(event.ref.fileId),
      ),
    /rules subscription unavailable/,
  )
  assert.deepEqual(active, new Set())
  assert.deepEqual(disposed, ["workspaces", "settings"])
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(events, [])
})

test("agent config filesystem: malformed store payload is rejected without changing the file", async () => {
  const fs = createAgentConfigFileSystem()
  const ref = agentConfigFileRef("rules")
  const before = await fs.read(ref, UI_CONTENT, { encoding: "text" })

  await assert.rejects(
    fs.write(
      ref,
      {
        data: [
          {
            id: "bad",
            name: "bad",
            description: "",
            activation: "always",
            glob: "",
            body: 42,
            scope: "global",
            enabled: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        expectedVersion: before.version,
      },
      UI_WRITE,
    ),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )

  const after = await fs.read(ref, UI_CONTENT, { encoding: "text" })
  assert.equal(after.data, before.data)
  assert.equal(after.version, before.version)
})

test("agent config filesystem: task writes enforce the Display batch bound before commit", async () => {
  const { deps } = fakeDeps({ tasks: [] })
  const fs = createAgentConfigFileSystem(deps)
  const ref = agentConfigFileRef("tasks")
  const before = await fs.read(ref, UI_CONTENT, { encoding: "text" })
  const oversized = Array.from({ length: MAX_AGENT_TASK_ITEMS + 1 }, (_, index) => ({
    id: `thread-${index}`,
    workspaceId: "workspace-1",
    status: "active",
    starred: false,
    createdAt: index,
    updatedAt: index,
  }))

  await assert.rejects(
    fs.write(ref, { data: oversized, expectedVersion: before.version }, UI_WRITE),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )

  const after = await fs.read(ref, UI_CONTENT, { encoding: "text" })
  assert.equal(after.data, before.data)
  assert.equal(after.version, before.version)
})

test("agent manifest: contributes its provider, mount and semantic Engines atomically", () => {
  const extension = agentManifest.runtimeExtensionFactory.create()

  assert.equal(extension.fileSystems?.length, 2)
  assert.equal(extension.fileSystems?.[0]?.provider, agentConfigFileSystem)
  assert.equal(extension.fileSystems?.[0]?.mount.entryId, AGENT_CONFIG_FILE_SYSTEM_ID)
  assert.deepEqual(extension.fileSystems?.[0]?.provider.descriptor.root, {
    fileSystemId: AGENT_CONFIG_FILE_SYSTEM_ID,
    fileId: "root",
  })
  assert.equal(extension.fileSystems?.[1]?.provider, agentAuditFileSystem)
  assert.equal(extension.fileSystems?.[1]?.mount.entryId, AGENT_AUDIT_FILE_SYSTEM_ID)
  assert.deepEqual(extension.fileSystems?.[1]?.provider.descriptor.root, AGENT_AUDIT_FILE_REF)
  assert.deepEqual(
    extension.engines?.map(({ descriptor }) => descriptor.engineId),
    [
      "ideall.agent-settings",
      "ideall.agent-spaces",
      "ideall.agent-tasks",
      "ideall.agent-write-audit",
    ],
  )
})
