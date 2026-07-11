import { test } from "node:test"
import assert from "node:assert/strict"
import {
  AGENT_DATA_SPEC,
  AGENT_EXPORT_KIND,
  AGENT_EXPORT_VERSION,
  AGENT_PUBLIC_CONFIG_SECTIONS,
  createAgentConfigExport,
  importAgentConfigJson,
  mergeAgentMcpPublicConfig,
  parseAgentConfigExport,
  readAgentPublicConfigSection,
  sanitizeAgentPublicConfigSection,
  subscribeAgentPublicConfigSection,
  writeAgentPublicConfigSection,
} from "./agent-data-port"
import { AGENT_SETTINGS_STORAGE_KEY, getAgentSettings, setAgentSettings } from "./agent-settings"
import { AGENT_SECRETS_STORAGE_KEY } from "./agent-secrets"
import {
  AGENT_WORKSPACES_STORAGE_KEY,
  createWorkspace,
  getActiveWorkspace,
  getWorkspace,
  getWorkspacesState,
  resolveModel,
  saveWorkspace,
  type WorkspacesState,
} from "./agent-workspace"
import { AGENT_MCP_STORAGE_KEY } from "./agent-mcp-registry"
import type { McpServer } from "./agent-mcp-registry"
import { AGENT_RULES_STORAGE_KEY, activeRulesText, getRules, type AgentRule } from "./agent-rules"
import type { AgentSkill } from "./agent-skills"
import { PLUGIN_DATA_PACKAGE_KIND, PLUGIN_DATA_PACKAGE_VERSION } from "@/plugins/shared/plugin-data"
import { secureFallbackStorageKey } from "@/lib/secure-store"

const mem = new Map<string, string>()
const localStorageStub: Storage = {
  getItem: (key) => mem.get(key) ?? null,
  setItem: (key, value) => void mem.set(key, value),
  removeItem: (key) => void mem.delete(key),
  clear: () => mem.clear(),
  key: (index) => [...mem.keys()][index] ?? null,
  get length() {
    return mem.size
  },
}
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageStub,
  configurable: true,
})

test("public config section registry: file definitions are complete, ordered, and unique", () => {
  assert.deepEqual(
    AGENT_PUBLIC_CONFIG_SECTIONS.map(({ id, fileName }) => [id, fileName]),
    [
      ["settings", "settings.json"],
      ["workspaces", "workspaces.json"],
      ["rules", "rules.json"],
      ["skills", "skills.json"],
      ["mcp", "mcp.json"],
      ["tasks", "tasks.json"],
    ],
  )
  assert.equal(
    new Set(AGENT_PUBLIC_CONFIG_SECTIONS.map((section) => section.storageKey)).size,
    AGENT_PUBLIC_CONFIG_SECTIONS.length,
  )
})

test("parseAgentConfigExport: 移除 API Key / 工作区覆盖 Key / 密钥值", () => {
  const pack = createAgentConfigExport(
    {
      [AGENT_SETTINGS_STORAGE_KEY]: {
        baseURL: "https://user:BASEPASS@api.example.test/v1?key=BASEQUERY#BASEFRAGMENT",
        model: "m",
        apiKey: "sk-secret",
      },
      [AGENT_WORKSPACES_STORAGE_KEY]: {
        workspaces: [
          {
            id: "ws1",
            model: {
              useGlobal: false,
              baseURL: "https://user:WSPASS@workspace.example/v1?auth=WSQUERY#WSFRAGMENT",
              model: "m",
              apiKey: "workspace-secret",
            },
          },
        ],
        activeId: "ws1",
      },
      [AGENT_SECRETS_STORAGE_KEY]: [{ id: "TOK", value: "Bearer secret" }],
      [AGENT_MCP_STORAGE_KEY]: [
        {
          id: "mcp-1",
          name: "MCP",
          transport: "http",
          command: "",
          args: '-H "Authorization: Bearer TOPSECRET" --headers headers-secret.json --config config-secret.json --data token=DATASECRET https://example.test/run?key=URLSECRET&auth=AUTHSECRET&query_key=QUERYSECRET&safe=visible',
          url: "https://user:PASS@example.test/mcp?key=url-key&auth=url-auth&query_key=url-query&safe=visible&ref=${TOKEN}#FRAGMENTSECRET",
          env: [
            { key: "API_KEY", value: "env-secret" },
            { key: "SAFE_REF", value: "${TOKEN}" },
          ],
          headers: [
            { key: "Authorization", value: "Bearer header-secret" },
            { key: "X-Token", value: "Bearer ${TOKEN}" },
          ],
          auth: "none",
          enabled: true,
          builtin: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    },
    "now",
  )

  const parsed = parseAgentConfigExport(JSON.stringify(pack))
  assert.equal(parsed.kind, PLUGIN_DATA_PACKAGE_KIND)
  assert.equal(parsed.version, PLUGIN_DATA_PACKAGE_VERSION)
  assert.deepEqual(parsed.plugin, {
    id: AGENT_DATA_SPEC.pluginId,
    label: AGENT_DATA_SPEC.pluginLabel,
    dataKind: AGENT_EXPORT_KIND,
    dataVersion: AGENT_EXPORT_VERSION,
  })
  assert.equal(parsed.exportedAt, "now")
  assert.deepEqual(parsed.payload.values[AGENT_SETTINGS_STORAGE_KEY], {
    baseURL: "https://api.example.test/v1",
    model: "m",
  })
  assert.deepEqual(parsed.payload.values[AGENT_SECRETS_STORAGE_KEY], [
    { id: "TOK", value: "", secure: true },
  ])
  assert.equal(
    JSON.stringify(parsed.payload.values[AGENT_WORKSPACES_STORAGE_KEY]).includes(
      "workspace-secret",
    ),
    false,
  )
  const workspaces = parsed.payload.values[AGENT_WORKSPACES_STORAGE_KEY] as WorkspacesState
  assert.equal(workspaces.workspaces[0].model.baseURL, "https://workspace.example/v1")
  assert.equal(JSON.stringify(parsed).includes("sk-secret"), false)
  for (const secret of [
    "TOPSECRET",
    "DATASECRET",
    "URLSECRET",
    "AUTHSECRET",
    "QUERYSECRET",
    "PASS",
    "FRAGMENTSECRET",
    "BASEPASS",
    "BASEQUERY",
    "BASEFRAGMENT",
    "WSPASS",
    "WSQUERY",
    "WSFRAGMENT",
    "url-key",
    "url-auth",
    "url-query",
    "env-secret",
    "header-secret",
  ]) {
    assert.equal(JSON.stringify(parsed).includes(secret), false)
  }
  const mcp = parsed.payload.values[AGENT_MCP_STORAGE_KEY] as McpServer[]
  assert.equal(mcp[0].args, "")
  assert.equal(new URL(mcp[0].url).searchParams.get("safe"), "")
  assert.equal(new URL(mcp[0].url).searchParams.get("ref"), "${TOKEN}")
  assert.equal(new URL(mcp[0].url).hash, "")
  assert.equal(mcp[0].env[1].value, "${TOKEN}")
  assert.equal(mcp[0].headers[1].value, "Bearer ${TOKEN}")
})

test("workspace public projection: unknown future fields are fail-closed", () => {
  const projected = sanitizeAgentPublicConfigSection("workspaces", {
    activeId: "ws-safe",
    rootPrivateValue: "root-secret",
    workspaces: [
      {
        id: "ws-safe",
        name: "Safe",
        privateValue: "workspace-secret",
        data: {
          includeHome: true,
          home: {
            notes: true,
            subscriptions: true,
            bookmarks: true,
            folders: true,
            files: true,
            authorization: "home-secret",
          },
          dirNodeId: null,
          osDir: null,
          credentialHint: "data-secret",
        },
        capabilities: {
          permissions: ["fs:read"],
          toolAllowlist: null,
          skillIds: null,
          appIds: null,
          clientSecret: "capability-secret",
        },
        rules: { ruleIds: [], tokenMetadata: "rules-secret" },
        prompt: {
          instructions: "public instruction",
          template: "",
          precise: false,
          override: "",
          privateTemplate: "prompt-secret",
        },
        model: {
          useGlobal: false,
          baseURL: "https://api.example.test/v1",
          model: "m",
          apiKey: "api-secret",
          clientSecret: "model-secret",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  })
  const json = JSON.stringify(projected)
  for (const secret of [
    "root-secret",
    "workspace-secret",
    "home-secret",
    "data-secret",
    "capability-secret",
    "rules-secret",
    "prompt-secret",
    "api-secret",
    "model-secret",
  ]) {
    assert.equal(json.includes(secret), false, `public workspace leaked ${secret}`)
  }
  assert.equal(json.includes("public instruction"), true)
})

test("workspace public projection: known scalar fields cannot smuggle structured secrets", () => {
  const projected = sanitizeAgentPublicConfigSection("workspaces", {
    activeId: { token: "active-secret" },
    workspaces: [
      {
        id: "ws-safe",
        name: { token: "name-secret" },
        data: {
          includeHome: true,
          home: {
            notes: true,
            subscriptions: true,
            bookmarks: true,
            folders: true,
            files: true,
          },
          dirNodeId: null,
          osDir: null,
        },
        capabilities: {
          permissions: ["fs:read"],
          toolAllowlist: null,
          skillIds: null,
          appIds: null,
        },
        rules: { ruleIds: [] },
        prompt: { instructions: "", template: "", precise: false, override: "" },
        model: { useGlobal: true, baseURL: "", model: "" },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  })
  assert.equal((projected as WorkspacesState).activeId, "")
  assert.equal(JSON.stringify(projected).includes("secret"), false)
})

test("settings and MCP public projections validate allowlisted scalar field types", () => {
  const settings = sanitizeAgentPublicConfigSection("settings", {
    baseURL: "https://api.example.test/v1",
    model: { token: "model-secret" },
    includeHomeContext: { token: "context-secret" },
    defaultAgentMode: true,
    approvalPolicy: "confirm",
  })
  assert.equal(JSON.stringify(settings).includes("secret"), false)

  const mcp = sanitizeAgentPublicConfigSection("mcp", [
    {
      id: "bad",
      name: "Bad",
      transport: { token: "transport-secret" },
      command: "",
      args: "",
      url: "",
      env: [],
      headers: [],
      auth: "none",
      enabled: true,
      builtin: false,
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  assert.deepEqual(mcp, [])
  assert.equal(JSON.stringify(mcp).includes("secret"), false)
})

test("sensitive section sanitizers do not echo malformed raw payloads", () => {
  const parsed = parseAgentConfigExport(
    JSON.stringify(
      createAgentConfigExport({
        [AGENT_SETTINGS_STORAGE_KEY]: "settings-secret",
        [AGENT_WORKSPACES_STORAGE_KEY]: { activeId: "", privateValue: "workspace-secret" },
        [AGENT_MCP_STORAGE_KEY]: "mcp-secret",
        [AGENT_SECRETS_STORAGE_KEY]: "vault-secret",
      }),
    ),
  )
  const json = JSON.stringify(parsed)
  for (const secret of ["settings-secret", "workspace-secret", "mcp-secret", "vault-secret"]) {
    assert.equal(json.includes(secret), false)
  }
})

function mcp(overrides: Partial<McpServer>): McpServer {
  return {
    id: "mcp-1",
    name: "MCP",
    transport: "http",
    command: "",
    args: "",
    url: "",
    env: [],
    headers: [],
    auth: "none",
    enabled: true,
    builtin: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

test("mergeAgentMcpPublicConfig: remote secrets only restore for the same transport and endpoint", () => {
  const current = mcp({
    transport: "http",
    url: "https://api.example.test/mcp?key=URLSECRET&ref=${TOKEN}",
    headers: [
      { key: "Authorization", value: "Bearer HEADERSECRET" },
      { key: "X-Token", value: "Bearer ${TOKEN}" },
    ],
  })
  const publicConfig = sanitizeAgentPublicConfigSection("mcp", [current]) as McpServer[]

  const unchanged = mergeAgentMcpPublicConfig(publicConfig, [current])
  assert.equal(unchanged[0].headers?.[0].value, "Bearer HEADERSECRET")
  assert.equal(new URL(unchanged[0].url ?? "").searchParams.get("key"), "URLSECRET")

  const redirected = mergeAgentMcpPublicConfig(
    [{ ...publicConfig[0], url: "https://evil.example/mcp?key=&ref=${TOKEN}" }],
    [current],
  )
  assert.equal(redirected[0].headers?.[0].value, "")
  assert.equal(redirected[0].headers?.[1].value, "")
  assert.equal(new URL(redirected[0].url ?? "").searchParams.get("key"), "")
  assert.equal(new URL(redirected[0].url ?? "").searchParams.get("ref"), "")
  assert.equal(JSON.stringify(redirected).includes("HEADERSECRET"), false)
  assert.equal(JSON.stringify(redirected).includes("URLSECRET"), false)

  const movedPath = mergeAgentMcpPublicConfig(
    [{ ...publicConfig[0], url: "https://api.example.test/collector?key=" }],
    [current],
  )
  assert.equal(movedPath[0].headers?.[0].value, "")
  assert.equal(JSON.stringify(movedPath).includes("HEADERSECRET"), false)
  assert.equal(JSON.stringify(movedPath).includes("URLSECRET"), false)

  const changedTransport = mergeAgentMcpPublicConfig(
    [{ ...publicConfig[0], transport: "sse" }],
    [current],
  )
  assert.equal(changedTransport[0].headers?.[0].value, "")
  assert.equal(JSON.stringify(changedTransport).includes("HEADERSECRET"), false)

  const newServer = mergeAgentMcpPublicConfig(publicConfig, [])
  assert.equal(newServer[0].headers?.[1].value, "")
  assert.equal(new URL(newServer[0].url ?? "").searchParams.get("ref"), "")
})

test("mergeAgentMcpPublicConfig: stdio secrets only restore for the same command", () => {
  const current = mcp({
    transport: "stdio",
    command: "trusted-mcp",
    args: '--header "Authorization: Bearer ARGSECRET" https://api.test/run?key=URLSECRET',
    env: [
      { key: "API_KEY", value: "ENVSECRET" },
      { key: "TOKEN_REF", value: "${TOKEN}" },
    ],
  })
  const publicConfig = sanitizeAgentPublicConfigSection("mcp", [current]) as McpServer[]

  const unchanged = mergeAgentMcpPublicConfig(publicConfig, [current])
  assert.equal(unchanged[0].args, current.args)
  assert.equal(unchanged[0].env?.[0].value, "ENVSECRET")

  const redirected = mergeAgentMcpPublicConfig(
    [{ ...publicConfig[0], command: "evil-mcp" }],
    [current],
  )
  assert.equal(redirected[0].command, "evil-mcp")
  assert.equal(redirected[0].env?.[0].value, "")
  assert.equal(redirected[0].env?.[1].value, "")
  assert.equal(JSON.stringify(redirected).includes("ARGSECRET"), false)
  assert.equal(JSON.stringify(redirected).includes("URLSECRET"), false)
  assert.equal(JSON.stringify(redirected).includes("ENVSECRET"), false)
})

test("public config data port: skills write uses the real store and subscription", () => {
  let notifications = 0
  const unsubscribe = subscribeAgentPublicConfigSection("skills", () => {
    notifications += 1
  })
  const custom: AgentSkill = {
    id: "skill-custom",
    label: "自定义技能",
    hint: "用于测试",
    prompt: "执行测试",
    builtin: false,
    enabled: true,
    invocation: "manual",
  }

  writeAgentPublicConfigSection("skills", [custom])
  const skills = readAgentPublicConfigSection("skills") as AgentSkill[]
  unsubscribe()

  assert.equal(notifications, 1)
  assert.ok(skills.some((skill) => skill.id === custom.id))
  assert.ok(skills.some((skill) => skill.id === "summarize-active" && skill.builtin))
})

test("public config data port: workspace API Key is target-bound to model endpoint", () => {
  let workspace = getActiveWorkspace()
  if (!workspace) workspace = createWorkspace("安全测试")
  saveWorkspace({
    ...workspace,
    model: {
      useGlobal: false,
      baseURL: "https://api.example.test/v1",
      model: "m",
      apiKey: "workspace-key",
    },
  })
  const secureKey = secureFallbackStorageKey(`ideall:agent:workspace:${workspace.id}:apiKey`)
  assert.equal(mem.get(secureKey), "workspace-key")

  const sameOrigin = readAgentPublicConfigSection("workspaces") as WorkspacesState
  sameOrigin.workspaces[0].model.baseURL =
    "https://user:pass@api.example.test/v1?key=query-secret#fragment-secret"
  writeAgentPublicConfigSection("workspaces", sameOrigin)
  const preserved = getWorkspace(workspace.id)
  assert.ok(preserved)
  assert.equal(preserved.model.baseURL, "https://api.example.test/v1")
  assert.equal(resolveModel(preserved).apiKey, "workspace-key")

  const redirected = readAgentPublicConfigSection("workspaces") as WorkspacesState
  redirected.workspaces[0].model.baseURL = "https://api.example.test/v2"
  writeAgentPublicConfigSection("workspaces", redirected)
  const changed = getWorkspace(workspace.id)
  assert.ok(changed)
  assert.equal(resolveModel(changed).apiKey, "")
  assert.equal(mem.get(secureKey), undefined)
})

function validRule(id: string): AgentRule {
  return {
    id,
    name: id,
    description: "",
    activation: "always",
    glob: "",
    body: "valid",
    scope: "global",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  }
}

test("public config data port: malformed sections and duplicate ids are atomically rejected", () => {
  if (getWorkspacesState().workspaces.length === 0) createWorkspace("校验测试")
  const workspace = readAgentPublicConfigSection("workspaces") as WorkspacesState
  ;(workspace.workspaces[0].data.home as unknown as { files: unknown }).files = "yes"

  const cases: Array<{
    section: "settings" | "rules" | "skills" | "workspaces" | "tasks" | "mcp"
    value: unknown
  }> = [
    {
      section: "settings",
      value: {
        baseURL: "https://api.example.test/v1",
        model: { token: "structured-secret" },
        includeHomeContext: true,
        defaultAgentMode: true,
        approvalPolicy: "confirm",
      },
    },
    { section: "rules", value: [{ ...validRule("bad-rule"), body: 42 }] },
    {
      section: "skills",
      value: [
        {
          id: "bad-skill",
          label: "bad",
          hint: "",
          prompt: 42,
          builtin: false,
          enabled: true,
          invocation: "manual",
        },
      ],
    },
    { section: "workspaces", value: workspace },
    {
      section: "tasks",
      value: [
        {
          id: "task-1",
          workspaceId: "ws-1",
          status: "queued",
          starred: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    },
    {
      section: "mcp",
      value: [
        mcp({
          env: [{ key: "TOKEN", value: 42 as unknown as string }],
        }),
      ],
    },
  ]

  for (const item of cases) {
    const before = JSON.stringify(readAgentPublicConfigSection(item.section))
    assert.throws(() => writeAgentPublicConfigSection(item.section, item.value))
    assert.equal(JSON.stringify(readAgentPublicConfigSection(item.section)), before)
  }

  const rulesBefore = JSON.stringify(getRules())
  assert.throws(() =>
    writeAgentPublicConfigSection("rules", [validRule("duplicate"), validRule("duplicate")]),
  )
  assert.equal(JSON.stringify(getRules()), rulesBefore)
  assert.doesNotThrow(() => activeRulesText(null))
})

test("agent config import: validates every public section before committing any store", async () => {
  setAgentSettings({
    baseURL: "https://before.example/v1",
    model: "before-model",
    apiKey: "before-secret",
    includeHomeContext: true,
    defaultAgentMode: true,
    approvalPolicy: "confirm",
  })
  const beforeSettings = { ...getAgentSettings() }
  const beforeRules = JSON.stringify(getRules())
  const pack = createAgentConfigExport({
    [AGENT_SETTINGS_STORAGE_KEY]: {
      baseURL: "https://after.example/v1",
      model: "after-model",
      includeHomeContext: false,
      defaultAgentMode: false,
      approvalPolicy: "auto",
    },
    [AGENT_RULES_STORAGE_KEY]: [{ ...validRule("invalid-import-rule"), body: 42 }],
  })

  await assert.rejects(() => importAgentConfigJson(JSON.stringify(pack)))
  assert.deepEqual(getAgentSettings(), beforeSettings)
  assert.equal(JSON.stringify(getRules()), beforeRules)
})
