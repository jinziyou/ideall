import assert from "node:assert/strict"
import { test } from "node:test"
import { FileSystemError } from "@/filesystem/types"
import { ideallRootFileSystem, registerBuiltInFileSystems } from "@/filesystem/builtin"
import { getFileSystem } from "@/filesystem/registry"
import {
  sanitizeAgentPublicConfigSection,
  type AgentPublicConfigSectionId,
} from "./lib/agent-data-port"
import { agentManifest } from "./manifest"
import {
  AGENT_CONFIG_FILE_SYSTEM_ID,
  agentConfigFileRef,
  createAgentConfigFileSystem,
  type AgentConfigFileSystemDeps,
} from "./agent-config-file-system"

type FakeAgentConfig = Record<AgentPublicConfigSectionId, unknown>

function fakeDeps(initial?: Partial<FakeAgentConfig>): {
  deps: AgentConfigFileSystemDeps
  state: FakeAgentConfig
  emit(section: AgentPublicConfigSectionId): void
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
  const emit = (section: AgentPublicConfigSectionId) => {
    for (const listener of listeners.get(section) ?? []) listener()
  }
  return {
    state,
    emit,
    deps: {
      read(section) {
        return state[section]
      },
      write(section, value) {
        state[section] = sanitizeAgentPublicConfigSection(section, value)
        emit(section)
      },
      subscribe(section, listener) {
        const current = listeners.get(section) ?? new Set()
        current.add(listener)
        listeners.set(section, current)
        return () => current.delete(listener)
      },
    },
  }
}

const UI_METADATA = { actor: "ui", permissions: [], intent: "metadata" } as const
const UI_DIRECTORY = { actor: "ui", permissions: [], intent: "directory" } as const
const UI_CONTENT = { actor: "ui", permissions: [], intent: "content" } as const
const UI_WRITE = { actor: "ui", permissions: [], intent: "write" } as const

test("agent config filesystem: exposes six stable JSON files backed by real config", async () => {
  const fixture = fakeDeps()
  const fs = createAgentConfigFileSystem(fixture.deps)

  assert.equal(fs.descriptor.fileSystemId, AGENT_CONFIG_FILE_SYSTEM_ID)
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
  assert.deepEqual(events, [rulesRef.fileId])
  handle?.dispose()
})

test("agent config filesystem: a root Engine watch cannot fingerprint child content versions", () => {
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
  assert.equal(consentedEvents[0]?.fileId, "config:rules")
  assert.equal(typeof consentedEvents[0]?.version, "string")
  engineWatch?.dispose()
  consentedWatch?.dispose()
})

test("agent config filesystem: a partial root watch failure rolls back every established section", () => {
  const fixture = fakeDeps()
  const active = new Set<AgentPublicConfigSectionId>()
  const disposed: AgentPublicConfigSectionId[] = []
  const fs = createAgentConfigFileSystem({
    ...fixture.deps,
    subscribe(section, listener) {
      if (section === "rules") throw new Error("rules subscription unavailable")
      active.add(section)
      const upstream = fixture.deps.subscribe(section, listener)
      return () => {
        upstream()
        active.delete(section)
        disposed.push(section)
      }
    },
  })

  assert.throws(
    () =>
      fs.watch?.(
        fs.descriptor.root,
        { actor: "ui", permissions: [], intent: "watch" },
        () => undefined,
      ),
    /rules subscription unavailable/,
  )
  assert.deepEqual(active, new Set())
  assert.deepEqual(disposed, ["workspaces", "settings"])
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

test("agent manifest: mounts app.agent-config into the composite root idempotently", async () => {
  registerBuiltInFileSystems()
  agentManifest.register()
  agentManifest.register()

  assert.ok(getFileSystem(AGENT_CONFIG_FILE_SYSTEM_ID))
  const root = await ideallRootFileSystem.readDirectory(
    ideallRootFileSystem.descriptor.root,
    UI_DIRECTORY,
  )
  const mounted = root.entries.filter((entry) => entry.entryId === AGENT_CONFIG_FILE_SYSTEM_ID)
  assert.equal(mounted.length, 1)
  assert.deepEqual(mounted[0].target, { fileSystemId: AGENT_CONFIG_FILE_SYSTEM_ID, fileId: "root" })
})
