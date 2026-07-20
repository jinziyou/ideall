import assert from "node:assert/strict"
import { test } from "node:test"
import { FileSystemRegistry } from "@/filesystem/registry"
import { FileSystemError } from "@/filesystem/types"
import {
  MCP_CONNECTOR_INVOKE_ACTION,
  createMcpConnectorFileSystem,
  type McpConnectorAudit,
  type McpConnectorClient,
} from "./mcp-file-system"

const UI_METADATA = { actor: "ui", permissions: [], intent: "metadata" } as const
const UI_DIRECTORY = { actor: "ui", permissions: [], intent: "directory" } as const
const UI_CONTENT = { actor: "ui", permissions: [], intent: "content" } as const
const UI_ACTION = { actor: "ui", permissions: [], intent: "action" } as const

type FixtureOptions = Readonly<{
  audit?: McpConnectorAudit
  permissions?: readonly string[]
  callTool?: McpConnectorClient["callTool"]
}>

async function fixture(options: FixtureOptions = {}) {
  const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
  const listCalls: string[] = []
  const client: McpConnectorClient = {
    async listResources(cursor) {
      listCalls.push("resources")
      if (!cursor) {
        return {
          resources: [
            {
              uri: "private://documents/report?token=resource-secret",
              name: "private-resource-name",
              title: "Quarterly Report",
              description: "Research evidence from the authorized connector",
              mimeType: "text/markdown",
              size: 18,
              annotations: { lastModified: "2026-07-16T08:00:00.000Z" },
            },
          ],
          nextCursor: "page-2-secret",
        }
      }
      assert.equal(cursor, "page-2-secret")
      return {
        resources: [
          {
            uri: "private://documents/appendix",
            name: "Appendix",
            mimeType: "text/plain",
          },
        ],
      }
    },
    async listTools() {
      listCalls.push("tools")
      return {
        tools: [
          {
            name: "private_tool_name",
            title: "Summarize Report",
            description: "Creates a connector-side summary",
            inputSchema: {
              type: "object",
              properties: {
                focus: { type: "string", title: "Focus", maxLength: 120 },
                count: { type: "integer", minimum: 1, maximum: 10 },
              },
              required: ["focus"],
              additionalProperties: false,
            },
            annotations: { destructiveHint: true, idempotentHint: false },
          },
        ],
      }
    },
    async readResource(uri) {
      assert.equal(uri, "private://documents/report?token=resource-secret")
      return {
        contents: [{ uri, mimeType: "text/markdown", text: "# Authorized report" }],
      }
    },
    async callTool(name, args) {
      calls.push({ name, args })
      return options.callTool
        ? options.callTool(name, args)
        : { structuredContent: { summaryId: "summary-1" } }
    },
  }
  const bridge = createMcpConnectorFileSystem({
    extensionId: "acme.search",
    extensionLabel: "Acme Search",
    publisher: "acme.official",
    version: 3,
    digest: `sha256:${"A".repeat(43)}`,
    permissions: options.permissions ?? ["resources:read", "tools:invoke"],
    audit: options.audit,
  })
  await bridge.attach(client)
  const registry = new FileSystemRegistry()
  registry.register(bridge.provider)
  return { bridge, registry, calls, listCalls }
}

test("connector FileSystem maps paged resources and tools without exposing private identities", async () => {
  const auditOrder: string[] = []
  const auditInputs: unknown[] = []
  const { bridge, registry, calls } = await fixture({
    audit: {
      async begin(input) {
        auditOrder.push("pending")
        auditInputs.push(input)
        assert.equal(calls.length, 0, "durable audit must precede the external side effect")
        return "audit-1"
      },
      async complete(input) {
        auditOrder.push(input.status)
      },
    },
  })

  const root = await registry.stat(bridge.rootRef, UI_METADATA)
  assert.equal(root?.source.kind, "third-party")
  assert.equal(root?.properties?.runtimeExtensionConnector, true)
  const rootPage = await registry.readDirectory(bridge.rootRef, UI_DIRECTORY)
  assert.deepEqual(
    rootPage.entries.map((entry) => entry.name),
    ["资源", "工具"],
  )

  const resourcePage = await registry.readDirectory(bridge.resourcesRef, UI_DIRECTORY)
  assert.equal(resourcePage.entries.length, 2)
  const resourceEntry = resourcePage.entries.find((entry) => entry.name === "Quarterly Report")
  assert.ok(resourceEntry)
  const serializedResourceMetadata = JSON.stringify(resourceEntry)
  assert.doesNotMatch(serializedResourceMetadata, /private:\/\/|resource-secret|page-2-secret/)
  assert.match(resourceEntry.target.fileId, /^resource:[a-f0-9]{64}$/)
  const resourceBeforeUpdate = await registry.stat(resourceEntry.target, UI_METADATA)
  bridge.resourceUpdated("private://documents/report?token=resource-secret")
  const resourceAfterUpdate = await registry.stat(resourceEntry.target, UI_METADATA)
  assert.notEqual(resourceAfterUpdate?.version, resourceBeforeUpdate?.version)
  const resource = await registry.read(resourceEntry.target, UI_CONTENT, { encoding: "text" })
  assert.equal(resource.version, resourceAfterUpdate?.version)
  assert.equal(resource.data, "# Authorized report")
  assert.equal(resource.mediaType, "text/markdown")

  const toolPage = await registry.readDirectory(bridge.toolsRef, UI_DIRECTORY)
  const toolEntry = toolPage.entries[0]
  assert.equal(toolEntry.name, "Summarize Report")
  assert.match(toolEntry.target.fileId, /^tool:[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(toolEntry), /private_tool_name/)
  const toolFile = await registry.stat(toolEntry.target, UI_METADATA)
  assert.ok(toolFile?.version)
  const actions = await registry.actions(toolEntry.target, UI_ACTION)
  assert.equal(actions[0]?.id, MCP_CONNECTOR_INVOKE_ACTION)
  assert.equal(actions[0]?.kind, "invoke")
  assert.equal(actions[0]?.risk, "destructive")
  assert.deepEqual(actions[0]?.kind === "invoke" ? actions[0].input : undefined, {
    type: "object",
    properties: {
      focus: { type: "string", title: "Focus", maxLength: 120 },
      count: { type: "integer", minimum: 1, maximum: 10 },
    },
    required: ["focus"],
    additionalProperties: false,
  })

  const result = await registry.invoke(
    toolEntry.target,
    MCP_CONNECTOR_INVOKE_ACTION,
    { focus: "revenue", count: 2 },
    UI_ACTION,
    { expectedVersion: toolFile?.version },
  )
  assert.deepEqual(result, { summaryId: "summary-1" })
  assert.deepEqual(calls, [{ name: "private_tool_name", args: { focus: "revenue", count: 2 } }])
  assert.deepEqual(auditOrder, ["pending", "committed"])
  assert.doesNotMatch(JSON.stringify(auditInputs), /revenue|resource-secret|private_tool_name/)
})

test("connector tool fails closed when durable audit cannot be written", async () => {
  const { bridge, registry, calls } = await fixture({
    audit: {
      async begin() {
        throw new Error("storage unavailable with private detail")
      },
      async complete() {
        assert.fail("completion must not run when pending audit was not written")
      },
    },
  })
  const tool = (await registry.readDirectory(bridge.toolsRef, UI_DIRECTORY)).entries[0]
  await assert.rejects(
    registry.invoke(tool.target, MCP_CONNECTOR_INVOKE_ACTION, { focus: "secret-input" }, UI_ACTION),
    (error: unknown) => {
      assert.ok(error instanceof FileSystemError)
      assert.equal(error.code, "unavailable")
      assert.doesNotMatch(error.message, /private detail|secret-input/)
      return true
    },
  )
  assert.equal(calls.length, 0)
})

test("connector transport failures keep the audit pending without exposing remote errors", async () => {
  const completions: string[] = []
  const { bridge, registry } = await fixture({
    audit: {
      async begin() {
        return "audit-failed"
      },
      async complete(input) {
        completions.push(input.status)
      },
    },
    callTool: async () => {
      throw new Error("remote failure token=private-secret")
    },
  })
  const tool = (await registry.readDirectory(bridge.toolsRef, UI_DIRECTORY)).entries[0]
  await assert.rejects(
    registry.invoke(tool.target, MCP_CONNECTOR_INVOKE_ACTION, { focus: "x" }, UI_ACTION),
    (error: unknown) => {
      assert.ok(error instanceof FileSystemError)
      assert.equal(error.code, "conflict")
      assert.doesNotMatch(error.message, /private-secret|remote failure/)
      return true
    },
  )
  assert.deepEqual(completions, [])
})

test("connector application errors settle the durable audit as failed", async () => {
  const completions: string[] = []
  const { bridge, registry } = await fixture({
    audit: {
      async begin() {
        return "audit-application-error"
      },
      async complete(input) {
        completions.push(input.status)
      },
    },
    callTool: async () => ({
      isError: true,
      content: [{ type: "text", text: "remote detail token=private-secret" }],
    }),
  })
  const tool = (await registry.readDirectory(bridge.toolsRef, UI_DIRECTORY)).entries[0]
  await assert.rejects(
    registry.invoke(tool.target, MCP_CONNECTOR_INVOKE_ACTION, { focus: "x" }, UI_ACTION),
    (error: unknown) => {
      assert.ok(error instanceof FileSystemError)
      assert.equal(error.code, "unavailable")
      assert.doesNotMatch(error.message, /private-secret|remote detail/)
      return true
    },
  )
  assert.deepEqual(completions, ["failed"])
})

test("connector FileSystem enforces manifest permissions, UI access and action versions", async () => {
  const { bridge, registry, calls, listCalls } = await fixture({
    permissions: ["resources:read"],
  })
  const rootPage = await registry.readDirectory(bridge.rootRef, UI_DIRECTORY)
  assert.deepEqual(
    rootPage.entries.map((entry) => entry.name),
    ["资源"],
  )
  await assert.rejects(
    registry.stat(bridge.rootRef, {
      actor: "agent",
      permissions: ["fs:read"],
      intent: "metadata",
    }),
    (error: unknown) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  assert.equal(calls.length, 0)
  assert.deepEqual(listCalls, ["resources", "resources"])
  await bridge.refreshTools()
  assert.deepEqual(listCalls, ["resources", "resources"])

  const withTools = await fixture({
    audit: {
      async begin() {
        return "audit-version"
      },
      async complete() {},
    },
  })
  const tool = (await withTools.registry.readDirectory(withTools.bridge.toolsRef, UI_DIRECTORY))
    .entries[0]
  await assert.rejects(
    withTools.registry.invoke(tool.target, MCP_CONNECTOR_INVOKE_ACTION, { focus: "x" }, UI_ACTION, {
      expectedVersion: "stale",
    }),
    (error: unknown) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.equal(withTools.calls.length, 0)
})

test("unsupported MCP schemas fall back to a bounded JSON input field", async () => {
  const bridge = createMcpConnectorFileSystem({
    extensionId: "acme.schema",
    extensionLabel: "Schema Connector",
    publisher: "acme.official",
    version: 1,
    digest: `sha256:${"C".repeat(43)}`,
    permissions: ["tools:invoke"],
    audit: {
      async begin() {
        return "audit-schema"
      },
      async complete() {},
    },
  })
  let received: unknown
  await bridge.attach({
    async listResources() {
      return { resources: [] }
    },
    async listTools() {
      return {
        tools: [
          {
            name: "complex",
            inputSchema: { type: "object", additionalProperties: true },
            annotations: { readOnlyHint: true },
          },
        ],
      }
    },
    async readResource() {
      return { contents: [] }
    },
    async callTool(_name, args) {
      received = args
      return { content: [{ type: "text", text: "ok" }] }
    },
  })
  const registry = new FileSystemRegistry()
  registry.register(bridge.provider)
  const tool = (await registry.readDirectory(bridge.toolsRef, UI_DIRECTORY)).entries[0]
  const action = (await registry.actions(tool.target, UI_ACTION))[0]
  assert.equal(action.kind, "invoke")
  assert.equal(action.risk, "caution")
  assert.equal(action.kind === "invoke" ? action.input?.type : undefined, "string")
  const result = await registry.invoke(
    tool.target,
    MCP_CONNECTOR_INVOKE_ACTION,
    '{"query":"bounded"}',
    UI_ACTION,
  )
  assert.deepEqual(received, { query: "bounded" })
  assert.deepEqual(result, { text: "ok" })
})

test("connector refresh generations ignore stale resource list completions", async () => {
  type ResourcePage = Awaited<ReturnType<McpConnectorClient["listResources"]>>
  let resolveOld: (value: ResourcePage) => void = () => undefined
  let resolveLatest: (value: ResourcePage) => void = () => undefined
  const oldPage = new Promise<ResourcePage>((resolve) => {
    resolveOld = resolve
  })
  const latestPage = new Promise<ResourcePage>((resolve) => {
    resolveLatest = resolve
  })
  let listCount = 0
  const bridge = createMcpConnectorFileSystem({
    extensionId: "acme.refresh",
    extensionLabel: "Refresh Connector",
    publisher: "acme.official",
    version: 1,
    digest: `sha256:${"D".repeat(43)}`,
    permissions: ["resources:read"],
  })
  const client: McpConnectorClient = {
    async listResources() {
      listCount += 1
      if (listCount === 1) {
        return { resources: [{ uri: "private://initial", name: "Initial" }] }
      }
      return listCount === 2 ? oldPage : latestPage
    },
    async listTools() {
      assert.fail("tools/list is outside the manifest grant")
    },
    async readResource(uri) {
      return { contents: [{ uri, text: "content" }] }
    },
    async callTool() {
      assert.fail("tools/call is outside the manifest grant")
    },
  }
  await bridge.attach(client)
  const older = bridge.refreshResources()
  const latest = bridge.refreshResources()
  resolveLatest({ resources: [{ uri: "private://latest", name: "Latest" }] })
  await latest
  resolveOld({ resources: [{ uri: "private://old", name: "Old" }] })
  await older

  const registry = new FileSystemRegistry()
  registry.register(bridge.provider)
  const page = await registry.readDirectory(bridge.resourcesRef, UI_DIRECTORY)
  assert.deepEqual(
    page.entries.map((entry) => entry.name),
    ["Latest"],
  )
})
