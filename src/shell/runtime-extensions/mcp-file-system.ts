import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
  type FileSource,
  type IdeallFile,
} from "@protocol/file-system"
import {
  AGENT_AUDIT_APPEND_ACTION,
  AGENT_AUDIT_COMPLETE_ACTION,
  AGENT_AUDIT_FILE_REF,
} from "@/filesystem/builtin-app-roots"
import { paginateDirectoryItems } from "@/filesystem/provider-input"
import { fileSystemRegistry } from "@/filesystem/registry"
import type {
  FileAction,
  FileActionInputSchema,
  FileActionInvokeOptions,
  FileReadOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchEvent,
  FileSystemWatchHandle,
  ReadDirectoryOptions,
} from "@/filesystem/types"
import { FileSystemError } from "@/filesystem/types"
import { base64ToBytes, isBase64 } from "@/lib/base64"
import { sha256SemanticVersion } from "@/lib/semantic-version"

export const MCP_CONNECTOR_RESOURCE_MEDIA_TYPE = "application/vnd.ideall.mcp-resource+json"
export const MCP_CONNECTOR_TOOL_MEDIA_TYPE = "application/vnd.ideall.mcp-tool+json"
export const MCP_CONNECTOR_INVOKE_ACTION = "mcp.invoke"

export const MAX_MCP_CONNECTOR_RESOURCES = 512
export const MAX_MCP_CONNECTOR_TOOLS = 256
export const MAX_MCP_CONNECTOR_LIST_PAGES = 32
export const MAX_MCP_CONNECTOR_RESOURCE_BYTES = 3 * 1024 * 1024
export const MAX_MCP_CONNECTOR_TOOL_INPUT_BYTES = 64 * 1024

const MAX_IDENTITY_LENGTH = 4_096
const MAX_NAME_LENGTH = 160
const MAX_DESCRIPTION_LENGTH = 1_024
const MAX_MEDIA_TYPE_LENGTH = 255
const MAX_SCHEMA_DEPTH = 5
const MAX_SCHEMA_PROPERTIES = 64
const MAX_SCHEMA_ENUM = 64
const MAX_TOOL_RESULT_TEXT = 2_048
const READ_TIMEOUT_MS = 30_000
const TOOL_TIMEOUT_MS = 60_000

type McpResourceValue = Readonly<{
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
  annotations?: Readonly<{ lastModified?: string }>
}>

type McpToolValue = Readonly<{
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
  annotations?: Readonly<{
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }>
}>

type McpReadResourceResult = Readonly<{
  contents: readonly Readonly<{
    uri: string
    mimeType?: string
    text?: string
    blob?: string
  }>[]
}>

type McpCallToolResult = Readonly<{
  content?: readonly unknown[]
  structuredContent?: unknown
  isError?: boolean
}>

export type McpConnectorClient = Readonly<{
  listResources(
    cursor?: string,
  ): Promise<Readonly<{ resources: readonly McpResourceValue[]; nextCursor?: string }>>
  listTools(
    cursor?: string,
  ): Promise<Readonly<{ tools: readonly McpToolValue[]; nextCursor?: string }>>
  readResource(uri: string): Promise<McpReadResourceResult>
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<McpCallToolResult>
}>

export type McpConnectorAudit = Readonly<{
  begin(
    input: Readonly<{
      extensionId: string
      extensionLabel: string
      toolId: string
      toolLabel: string
    }>,
  ): Promise<string>
  complete(input: Readonly<{ id: string; status: "committed" | "failed" }>): Promise<void>
}>

export type McpConnectorFileSystemOptions = Readonly<{
  extensionId: string
  extensionLabel: string
  publisher: string
  version: number
  digest: string
  permissions: readonly string[]
  audit?: McpConnectorAudit
}>

type MappedResource = Readonly<{
  type: "resource"
  ref: FileRef
  uri: string
  name: string
  description?: string
  mediaType: string
  size?: number
  updatedAt?: number
  version: string
}>

type MappedTool = Readonly<{
  type: "tool"
  ref: FileRef
  name: string
  label: string
  description?: string
  input?: FileActionInputSchema
  inputMode: "object" | "json-text"
  risk: "caution" | "destructive"
  idempotent: boolean
  version: string
}>

type ConnectorSnapshot = Readonly<{
  resources: readonly MappedResource[]
  resourcesById: ReadonlyMap<string, MappedResource>
  resourcesByUri: ReadonlyMap<string, MappedResource>
  tools: readonly MappedTool[]
  toolsById: ReadonlyMap<string, MappedTool>
  resourcesTruncated: boolean
  toolsTruncated: boolean
}>

type Watcher = Readonly<{
  ref: FileRef
  notify: (event: FileSystemWatchEvent) => void
}>

const EMPTY_SNAPSHOT: ConnectorSnapshot = Object.freeze({
  resources: Object.freeze([]),
  resourcesById: new Map(),
  resourcesByUri: new Map(),
  tools: Object.freeze([]),
  toolsById: new Map(),
  resourcesTruncated: false,
  toolsTruncated: false,
})

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function boundedText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== "string") return fallback
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim()
  if (!normalized) return fallback
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  const text = boundedText(value, maxLength, "")
  return text || undefined
}

function validPrivateIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTITY_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
}

function mediaType(value: unknown, fallback: string): string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_MEDIA_TYPE_LENGTH &&
    /^[\w!#$&^_.+-]+\/[\w!#$&^_.+*-]+(?:\s*;[^\u0000-\u001f\u007f]*)?$/u.test(value)
    ? value
    : fallback
}

function finiteSize(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function updatedAt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function timeout<T>(operation: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)
  })
  return Promise.race([operation, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

function assertReadAccess(ref: FileRef, ctx: FileSystemAccessContext): void {
  if (ctx.actor === "ui") return
  if (ctx.actor === "engine" && ctx.activeFile && sameFileRef(ctx.activeFile, ref)) return
  throw new FileSystemError(
    "permission-denied",
    "Connector files are available only to the trusted user interface",
    ref,
  )
}

function assertIntent(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  intent: NonNullable<FileSystemAccessContext["intent"]>,
): void {
  if (ctx.intent !== intent) {
    throw new FileSystemError("permission-denied", `Connector file requires ${intent} intent`, ref)
  }
  assertReadAccess(ref, ctx)
}

function assertUiAction(ref: FileRef, ctx: FileSystemAccessContext): void {
  if (ctx.actor !== "ui" || ctx.intent !== "action") {
    throw new FileSystemError(
      "permission-denied",
      "Connector tools require an explicit trusted UI action",
      ref,
    )
  }
}

function schemaText(
  schema: Record<string, unknown>,
  key: "title" | "description",
): string | undefined {
  return optionalText(schema[key], key === "title" ? MAX_NAME_LENGTH : MAX_DESCRIPTION_LENGTH)
}

function safeInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined
}

function sanitizeInputSchema(value: unknown, depth = 0): FileActionInputSchema | null {
  if (depth > MAX_SCHEMA_DEPTH) return null
  const schema = record(value)
  if (!schema || typeof schema.type !== "string") return null
  const title = schemaText(schema, "title")
  const description = schemaText(schema, "description")
  const common = { ...(title ? { title } : {}), ...(description ? { description } : {}) }
  if (schema.type === "string") {
    const rawEnum = Array.isArray(schema.enum) ? schema.enum : undefined
    const enumValues = rawEnum?.filter((item): item is string => typeof item === "string")
    if (
      enumValues &&
      (enumValues.length !== rawEnum?.length ||
        enumValues.length > MAX_SCHEMA_ENUM ||
        enumValues.some((item) => !validPrivateIdentity(item) || item.length > 256))
    ) {
      return null
    }
    const minimum = safeInteger(schema.minLength, 0, MAX_MCP_CONNECTOR_TOOL_INPUT_BYTES)
    const maximum = safeInteger(schema.maxLength, 0, MAX_MCP_CONNECTOR_TOOL_INPUT_BYTES)
    return {
      type: "string",
      ...common,
      ...(enumValues?.length ? { enum: [...enumValues] } : {}),
      ...(minimum !== undefined ? { minLength: minimum } : {}),
      ...(maximum !== undefined ? { maxLength: maximum } : {}),
    }
  }
  if (schema.type === "number" || schema.type === "integer") {
    const minimum =
      typeof schema.minimum === "number" && Number.isFinite(schema.minimum)
        ? schema.minimum
        : undefined
    const maximum =
      typeof schema.maximum === "number" && Number.isFinite(schema.maximum)
        ? schema.maximum
        : undefined
    return {
      type: schema.type,
      ...common,
      ...(minimum !== undefined ? { minimum } : {}),
      ...(maximum !== undefined ? { maximum } : {}),
    }
  }
  if (schema.type === "boolean") return { type: "boolean", ...common }
  if (schema.type === "array") {
    const items = sanitizeInputSchema(schema.items, depth + 1)
    if (!items) return null
    const minItems = safeInteger(schema.minItems, 0, 1_000)
    const maxItems = safeInteger(schema.maxItems, 0, 1_000)
    return {
      type: "array",
      items,
      ...common,
      ...(minItems !== undefined ? { minItems } : {}),
      ...(maxItems !== undefined ? { maxItems } : {}),
    }
  }
  if (schema.type !== "object") return null
  const sourceProperties = schema.properties === undefined ? {} : record(schema.properties)
  if (!sourceProperties || Object.keys(sourceProperties).length > MAX_SCHEMA_PROPERTIES) return null
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false)
    return null
  const properties: Record<string, FileActionInputSchema> = {}
  for (const [name, property] of Object.entries(sourceProperties)) {
    if (!validPrivateIdentity(name) || name.length > 128) return null
    const sanitized = sanitizeInputSchema(property, depth + 1)
    if (!sanitized) return null
    properties[name] = sanitized
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : []
  if (
    required.length > Object.keys(properties).length ||
    required.some((name) => !(name in properties))
  ) {
    return null
  }
  return {
    type: "object",
    ...common,
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }
}

function toolInput(value: unknown): Pick<MappedTool, "input" | "inputMode"> {
  const raw = record(value) ?? { type: "object", properties: {} }
  const sanitized = sanitizeInputSchema(raw)
  if (sanitized?.type === "object") {
    const hasProperties = Object.keys(sanitized.properties ?? {}).length > 0
    return {
      ...(hasProperties ? { input: sanitized } : {}),
      inputMode: "object",
    }
  }
  return {
    input: {
      type: "string",
      title: "JSON 参数",
      description: "此工具使用了通用表单无法完整表达的参数结构，请输入 JSON 对象。",
      format: "multiline",
      default: "{}",
      minLength: 2,
      maxLength: MAX_MCP_CONNECTOR_TOOL_INPUT_BYTES,
    },
    inputMode: "json-text",
  }
}

function parseToolArgs(tool: MappedTool, input: unknown): Record<string, unknown> {
  let candidate = input ?? {}
  if (tool.inputMode === "json-text") {
    if (typeof candidate !== "string") {
      throw new FileSystemError(
        "invalid-input",
        "Connector tool input must be a JSON object",
        tool.ref,
      )
    }
    try {
      candidate = JSON.parse(candidate)
    } catch {
      throw new FileSystemError("invalid-input", "Connector tool input is not valid JSON", tool.ref)
    }
  }
  const args = record(candidate)
  if (!args) {
    throw new FileSystemError("invalid-input", "Connector tool input must be an object", tool.ref)
  }
  let serialized: string
  try {
    serialized = JSON.stringify(args)
  } catch {
    throw new FileSystemError("invalid-input", "Connector tool input must be finite JSON", tool.ref)
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_MCP_CONNECTOR_TOOL_INPUT_BYTES) {
    throw new FileSystemError("invalid-input", "Connector tool input is too large", tool.ref)
  }
  return JSON.parse(serialized) as Record<string, unknown>
}

async function opaqueFileId(namespace: "resource" | "tool", identity: string): Promise<string> {
  const digest = await sha256SemanticVersion(`runtime-mcp-${namespace}-v1`, identity)
  return `${namespace}:${digest.slice(digest.lastIndexOf(":") + 1)}`
}

function defaultAudit(): McpConnectorAudit {
  return {
    async begin(input) {
      const result = await fileSystemRegistry.invoke(
        AGENT_AUDIT_FILE_REF,
        AGENT_AUDIT_APPEND_ACTION,
        {
          source: "tool",
          operation: "connector.tool",
          title: "调用连接器工具",
          summary: `准备通过“${boundedText(input.extensionLabel, MAX_NAME_LENGTH, "连接器")}”调用“${boundedText(input.toolLabel, MAX_NAME_LENGTH, "外部工具")}”`,
          status: "pending",
          effect: "external",
          risk: "high",
          target: {
            kind: "connector-tool",
            id: `${input.extensionId}:${input.toolId}`,
            label: `${boundedText(input.extensionLabel, MAX_NAME_LENGTH, "连接器")} / ${boundedText(input.toolLabel, MAX_NAME_LENGTH, "外部工具")}`,
          },
        },
        { actor: "ui", permissions: [], intent: "action" },
      )
      const id = record(result)?.id
      if (typeof id !== "string" || !id) throw new Error("Connector audit returned no id")
      return id
    },
    async complete(input) {
      await fileSystemRegistry.invoke(
        AGENT_AUDIT_FILE_REF,
        AGENT_AUDIT_COMPLETE_ACTION,
        {
          id: input.id,
          status: input.status,
          summary: input.status === "committed" ? "连接器工具调用已返回" : "连接器工具调用失败",
        },
        { actor: "ui", permissions: [], intent: "action" },
      )
    },
  }
}

async function collectPages<T>(
  label: string,
  maximum: number,
  list: (cursor?: string) => Promise<Readonly<{ items: readonly T[]; nextCursor?: string }>>,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < MAX_MCP_CONNECTOR_LIST_PAGES; page += 1) {
    const result = await timeout(list(cursor), READ_TIMEOUT_MS, label)
    if (!Array.isArray(result.items)) throw new Error(`${label} returned an invalid list`)
    const remaining = maximum - items.length
    const pageTruncated = result.items.length > remaining
    items.push(...result.items.slice(0, Math.max(0, remaining)))
    const next = result.nextCursor
    if (!next) return { items, truncated: pageTruncated }
    if (typeof next !== "string" || next.length > MAX_IDENTITY_LENGTH || cursors.has(next)) {
      throw new Error(`${label} returned an invalid cursor`)
    }
    if (items.length >= maximum) return { items, truncated: true }
    cursors.add(next)
    cursor = next
  }
  return { items, truncated: true }
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function rangedBytes(ref: FileRef, bytes: Uint8Array, options: FileReadOptions): Uint8Array {
  const start = options.range?.start ?? 0
  const end = options.range?.end ?? bytes.byteLength
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(end) ||
    end < start ||
    end > bytes.byteLength
  ) {
    throw new FileSystemError("invalid-input", "Invalid connector file byte range", ref)
  }
  return bytes.slice(start, end)
}

function readBytes(
  ref: FileRef,
  bytes: Uint8Array,
  resultMediaType: string,
  version: string,
  options: FileReadOptions,
): FileReadResult {
  const ranged = rangedBytes(ref, bytes, options)
  return {
    data: options.encoding === "binary" ? ranged : new TextDecoder().decode(ranged),
    mediaType: resultMediaType,
    size: ranged.byteLength,
    version,
  }
}

function checkedResourceContents(
  ref: FileRef,
  result: McpReadResourceResult,
): McpReadResourceResult["contents"] {
  if (
    !result ||
    !Array.isArray(result.contents) ||
    result.contents.length === 0 ||
    result.contents.length > 64
  ) {
    throw new FileSystemError("unavailable", "Connector returned invalid resource content", ref)
  }
  return result.contents
}

function resourcePayload(
  resource: MappedResource,
  result: McpReadResourceResult,
  options: FileReadOptions,
): FileReadResult {
  const contents = checkedResourceContents(resource.ref, result)
  let bytes: Uint8Array
  let outputMediaType = resource.mediaType
  let jsonValue: unknown
  if (contents.length === 1 && typeof contents[0]?.text === "string") {
    bytes = encodeText(contents[0].text)
    outputMediaType = mediaType(contents[0].mimeType, resource.mediaType)
    jsonValue = contents[0].text
  } else if (contents.length === 1 && typeof contents[0]?.blob === "string") {
    if (!isBase64(contents[0].blob)) {
      throw new FileSystemError(
        "unavailable",
        "Connector returned invalid binary content",
        resource.ref,
      )
    }
    bytes = base64ToBytes(contents[0].blob)
    outputMediaType = mediaType(contents[0].mimeType, resource.mediaType)
    jsonValue = { base64: contents[0].blob }
  } else {
    const safeContents = contents.map((content) => {
      if (typeof content.text === "string") {
        return {
          type: "text",
          mediaType: mediaType(content.mimeType, "text/plain"),
          text: content.text,
        }
      }
      if (typeof content.blob === "string" && isBase64(content.blob)) {
        return {
          type: "blob",
          mediaType: mediaType(content.mimeType, "application/octet-stream"),
          base64: content.blob,
        }
      }
      throw new FileSystemError(
        "unavailable",
        "Connector returned invalid resource content",
        resource.ref,
      )
    })
    const text = JSON.stringify({ version: 1, contents: safeContents }, null, 2)
    bytes = encodeText(text)
    jsonValue = { version: 1, contents: safeContents }
    outputMediaType = MCP_CONNECTOR_RESOURCE_MEDIA_TYPE
  }
  if (bytes.byteLength > MAX_MCP_CONNECTOR_RESOURCE_BYTES) {
    throw new FileSystemError("unavailable", "Connector resource is too large", resource.ref)
  }
  if ((options.encoding === undefined || options.encoding === "json") && options.range) {
    throw new FileSystemError(
      "invalid-input",
      "JSON reads do not support byte ranges",
      resource.ref,
    )
  }
  if (options.encoding === undefined || options.encoding === "json") {
    return {
      data: jsonValue,
      mediaType: outputMediaType,
      size: bytes.byteLength,
      version: resource.version,
    }
  }
  return readBytes(resource.ref, bytes, outputMediaType, resource.version, options)
}

function toolResultSummary(result: McpCallToolResult): unknown {
  const structured = record(result.structuredContent)
  if (structured) {
    try {
      const serialized = JSON.stringify(structured)
      if (encodeText(serialized).byteLength <= MAX_MCP_CONNECTOR_TOOL_INPUT_BYTES) {
        return JSON.parse(serialized) as unknown
      }
    } catch {}
    return { status: "completed", detail: "structured result omitted" }
  }
  const texts = Array.isArray(result.content)
    ? result.content.flatMap((item) => {
        const value = record(item)
        return value?.type === "text" && typeof value.text === "string"
          ? [boundedText(value.text, MAX_TOOL_RESULT_TEXT, "")]
          : []
      })
    : []
  return texts.length ? { text: texts.join("\n") } : { status: "completed" }
}

export class McpConnectorFileSystem {
  readonly provider: FileSystemProvider
  readonly rootRef: FileRef
  readonly resourcesRef: FileRef
  readonly toolsRef: FileRef
  readonly #options: McpConnectorFileSystemOptions
  readonly #source: FileSource
  readonly #audit: McpConnectorAudit
  readonly #watchers = new Set<Watcher>()
  readonly #resourceRevisions = new Map<string, number>()
  #client: McpConnectorClient | null = null
  #snapshot: ConnectorSnapshot = EMPTY_SNAPSHOT
  #generation = 0
  #resourcesRefreshGeneration = 0
  #toolsRefreshGeneration = 0

  constructor(options: McpConnectorFileSystemOptions) {
    this.#options = options
    this.#audit = options.audit ?? defaultAudit()
    const fileSystemId = `runtime-extension.${options.extensionId}`
    this.rootRef = { fileSystemId, fileId: "root" }
    this.resourcesRef = { fileSystemId, fileId: "resources" }
    this.toolsRef = { fileSystemId, fileId: "tools" }
    this.#source = Object.freeze({
      kind: "third-party",
      id: options.extensionId,
      label: options.extensionLabel,
      readOnly: true,
    })
    this.provider = this.#createProvider()
  }

  async attach(client: McpConnectorClient): Promise<void> {
    const generation = ++this.#generation
    this.#client = client
    try {
      const snapshot = await this.#loadSnapshot(client)
      if (generation !== this.#generation || this.#client !== client) return
      this.#resourceRevisions.clear()
      this.#snapshot = snapshot
    } catch (error) {
      if (generation === this.#generation && this.#client === client) {
        this.#client = null
        this.#snapshot = EMPTY_SNAPSHOT
      }
      throw error
    }
  }

  detach(): void {
    this.#generation += 1
    this.#client = null
    this.#snapshot = EMPTY_SNAPSHOT
    this.#resourceRevisions.clear()
    this.#emit({ type: "changed", ref: this.rootRef })
  }

  async refreshResources(): Promise<void> {
    if (!this.#options.permissions.includes("resources:read")) return
    const client = this.#requireClient(this.resourcesRef)
    const generation = this.#generation
    const refreshGeneration = ++this.#resourcesRefreshGeneration
    const resources = await this.#loadResources(client)
    if (
      generation !== this.#generation ||
      refreshGeneration !== this.#resourcesRefreshGeneration ||
      client !== this.#client
    )
      return
    for (const fileId of this.#resourceRevisions.keys()) {
      if (!resources.resourcesById.has(fileId)) this.#resourceRevisions.delete(fileId)
    }
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...resources })
    this.#emit({ type: "changed", ref: this.resourcesRef })
  }

  async refreshTools(): Promise<void> {
    if (!this.#options.permissions.includes("tools:invoke")) return
    const client = this.#requireClient(this.toolsRef)
    const generation = this.#generation
    const refreshGeneration = ++this.#toolsRefreshGeneration
    const tools = await this.#loadTools(client)
    if (
      generation !== this.#generation ||
      refreshGeneration !== this.#toolsRefreshGeneration ||
      client !== this.#client
    )
      return
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...tools })
    this.#emit({ type: "changed", ref: this.toolsRef })
  }

  resourceUpdated(uri: string): void {
    const resource = this.#snapshot.resourcesByUri.get(uri)
    if (resource) {
      this.#resourceRevisions.set(
        resource.ref.fileId,
        (this.#resourceRevisions.get(resource.ref.fileId) ?? 0) + 1,
      )
      this.#emit({
        type: "changed",
        ref: resource.ref,
        version: this.#resourceVersion(resource),
      })
    }
  }

  #resourceVersion(resource: MappedResource): string {
    return `${resource.version}:${this.#resourceRevisions.get(resource.ref.fileId) ?? 0}`
  }

  async #loadSnapshot(client: McpConnectorClient): Promise<ConnectorSnapshot> {
    const [resources, tools] = await Promise.all([
      this.#options.permissions.includes("resources:read")
        ? this.#loadResources(client)
        : Promise.resolve({
            resources: Object.freeze([]) as readonly MappedResource[],
            resourcesById: new Map<string, MappedResource>(),
            resourcesByUri: new Map<string, MappedResource>(),
            resourcesTruncated: false,
          }),
      this.#options.permissions.includes("tools:invoke")
        ? this.#loadTools(client)
        : Promise.resolve({
            tools: Object.freeze([]) as readonly MappedTool[],
            toolsById: new Map<string, MappedTool>(),
            toolsTruncated: false,
          }),
    ])
    return Object.freeze({ ...resources, ...tools })
  }

  async #loadResources(
    client: McpConnectorClient,
  ): Promise<
    Pick<ConnectorSnapshot, "resources" | "resourcesById" | "resourcesByUri" | "resourcesTruncated">
  > {
    const listed = await collectPages(
      "MCP resources/list",
      MAX_MCP_CONNECTOR_RESOURCES,
      async (cursor) => {
        const page = await client.listResources(cursor)
        return { items: page.resources, nextCursor: page.nextCursor }
      },
    )
    const resources: MappedResource[] = []
    const resourcesById = new Map<string, MappedResource>()
    const resourcesByUri = new Map<string, MappedResource>()
    for (const value of listed.items) {
      if (!validPrivateIdentity(value?.uri) || !validPrivateIdentity(value?.name)) {
        throw new Error("MCP resources/list returned an invalid resource")
      }
      if (resourcesByUri.has(value.uri))
        throw new Error("MCP resources/list returned duplicate URIs")
      const fileId = await opaqueFileId("resource", value.uri)
      if (resourcesById.has(fileId)) throw new Error("MCP resource identity collision")
      const title = boundedText(value.title ?? value.name, MAX_NAME_LENGTH, "未命名资源")
      const description = optionalText(value.description, MAX_DESCRIPTION_LENGTH)
      const mime = mediaType(value.mimeType, "application/octet-stream")
      const semantic = JSON.stringify([
        title,
        description ?? "",
        mime,
        value.size ?? null,
        value.annotations?.lastModified ?? "",
      ])
      const resource: MappedResource = Object.freeze({
        type: "resource",
        ref: { fileSystemId: this.rootRef.fileSystemId, fileId },
        uri: value.uri,
        name: title,
        ...(description ? { description } : {}),
        mediaType: mime,
        ...(finiteSize(value.size) !== undefined ? { size: finiteSize(value.size) } : {}),
        ...(updatedAt(value.annotations?.lastModified) !== undefined
          ? { updatedAt: updatedAt(value.annotations?.lastModified) }
          : {}),
        version: await sha256SemanticVersion("runtime-mcp-resource-meta-v1", semantic),
      })
      resources.push(resource)
      resourcesById.set(fileId, resource)
      resourcesByUri.set(value.uri, resource)
    }
    resources.sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.ref.fileId.localeCompare(right.ref.fileId),
    )
    return {
      resources: Object.freeze(resources),
      resourcesById,
      resourcesByUri,
      resourcesTruncated: listed.truncated,
    }
  }

  async #loadTools(
    client: McpConnectorClient,
  ): Promise<Pick<ConnectorSnapshot, "tools" | "toolsById" | "toolsTruncated">> {
    const listed = await collectPages("MCP tools/list", MAX_MCP_CONNECTOR_TOOLS, async (cursor) => {
      const page = await client.listTools(cursor)
      return { items: page.tools, nextCursor: page.nextCursor }
    })
    const tools: MappedTool[] = []
    const toolsById = new Map<string, MappedTool>()
    const names = new Set<string>()
    for (const value of listed.items) {
      if (!validPrivateIdentity(value?.name) || names.has(value.name)) {
        throw new Error("MCP tools/list returned an invalid or duplicate tool")
      }
      names.add(value.name)
      const fileId = await opaqueFileId("tool", value.name)
      if (toolsById.has(fileId)) throw new Error("MCP tool identity collision")
      const label = boundedText(
        value.title ?? value.annotations?.title ?? value.name,
        MAX_NAME_LENGTH,
        "未命名工具",
      )
      const description = optionalText(value.description, MAX_DESCRIPTION_LENGTH)
      const input = toolInput(value.inputSchema)
      const risk =
        value.annotations?.readOnlyHint === true && value.annotations?.destructiveHint !== true
          ? "caution"
          : "destructive"
      const semantic = JSON.stringify([
        label,
        description ?? "",
        input,
        risk,
        value.annotations?.idempotentHint === true,
      ])
      const tool: MappedTool = Object.freeze({
        type: "tool",
        ref: { fileSystemId: this.rootRef.fileSystemId, fileId },
        name: value.name,
        label,
        ...(description ? { description } : {}),
        ...input,
        risk,
        idempotent: value.annotations?.idempotentHint === true,
        version: await sha256SemanticVersion("runtime-mcp-tool-meta-v1", semantic),
      })
      tools.push(tool)
      toolsById.set(fileId, tool)
    }
    tools.sort(
      (left, right) =>
        left.label.localeCompare(right.label) || left.ref.fileId.localeCompare(right.ref.fileId),
    )
    return { tools: Object.freeze(tools), toolsById, toolsTruncated: listed.truncated }
  }

  #requireClient(ref: FileRef): McpConnectorClient {
    if (!this.#client) throw new FileSystemError("offline", "Connector is not active", ref)
    return this.#client
  }

  #file(ref: FileRef): IdeallFile | null {
    const common = { source: this.#source } as const
    if (sameFileRef(ref, this.rootRef)) {
      return {
        ref,
        kind: "directory",
        name: this.#options.extensionLabel,
        mediaType: DIRECTORY_MEDIA_TYPE,
        capabilities: ["read-directory", "watch"],
        ...common,
        version: `runtime-mcp-root-v1:${this.#options.version}:${this.#options.digest}`,
        properties: {
          runtimeExtensionConnector: true,
          extensionId: this.#options.extensionId,
          publisher: this.#options.publisher,
          localOnly: true,
          resourcesTruncated: this.#snapshot.resourcesTruncated,
          toolsTruncated: this.#snapshot.toolsTruncated,
        },
      }
    }
    if (sameFileRef(ref, this.resourcesRef)) {
      return {
        ref,
        kind: "directory",
        name: "资源",
        mediaType: DIRECTORY_MEDIA_TYPE,
        capabilities: ["read-directory", "watch"],
        ...common,
        properties: { runtimeExtensionConnector: true, mcpEntryType: "resources" },
      }
    }
    if (sameFileRef(ref, this.toolsRef)) {
      return {
        ref,
        kind: "directory",
        name: "工具",
        mediaType: DIRECTORY_MEDIA_TYPE,
        capabilities: ["read-directory", "watch"],
        ...common,
        properties: { runtimeExtensionConnector: true, mcpEntryType: "tools" },
      }
    }
    const resource = this.#snapshot.resourcesById.get(ref.fileId)
    if (resource) {
      return {
        ref,
        kind: "file",
        name: resource.name,
        mediaType: resource.mediaType,
        capabilities: ["read"],
        ...common,
        ...(resource.size !== undefined ? { size: resource.size } : {}),
        ...(resource.updatedAt !== undefined ? { updatedAt: resource.updatedAt } : {}),
        version: this.#resourceVersion(resource),
        properties: {
          runtimeExtensionConnector: true,
          runtimeExtensionSearchable: true,
          mcpEntryType: "resource",
          extensionLabel: this.#options.extensionLabel,
          ...(resource.description ? { searchDescription: resource.description } : {}),
        },
      }
    }
    const tool = this.#snapshot.toolsById.get(ref.fileId)
    if (tool) {
      return {
        ref,
        kind: "file",
        name: tool.label,
        mediaType: MCP_CONNECTOR_TOOL_MEDIA_TYPE,
        capabilities: ["read", "actions"],
        ...common,
        version: tool.version,
        properties: {
          runtimeExtensionConnector: true,
          runtimeExtensionSearchable: true,
          mcpEntryType: "tool",
          extensionLabel: this.#options.extensionLabel,
          risk: tool.risk,
          ...(tool.description ? { searchDescription: tool.description } : {}),
        },
      }
    }
    return null
  }

  #entry(parent: FileRef, file: IdeallFile, entryId: string): DirectoryEntry {
    return {
      entryId,
      parent,
      target: file.ref,
      name: file.name,
      kind: "child",
      file,
      properties: file.properties,
    }
  }

  #createProvider(): FileSystemProvider {
    return {
      descriptor: {
        fileSystemId: this.rootRef.fileSystemId,
        name: this.#options.extensionLabel,
        root: this.rootRef,
        source: this.#source,
        capabilities: ["read-directory", "read", "actions", "watch"],
      },
      stat: async (ref, ctx) => {
        assertIntent(ref, ctx, "metadata")
        return this.#file(ref)
      },
      readDirectory: async (ref, ctx, options: ReadDirectoryOptions = {}) => {
        assertIntent(ref, ctx, "directory")
        let entries: DirectoryEntry[]
        if (sameFileRef(ref, this.rootRef)) {
          entries = [
            ...(this.#options.permissions.includes("resources:read")
              ? [this.#entry(ref, this.#file(this.resourcesRef)!, "resources")]
              : []),
            ...(this.#options.permissions.includes("tools:invoke")
              ? [this.#entry(ref, this.#file(this.toolsRef)!, "tools")]
              : []),
          ]
        } else if (sameFileRef(ref, this.resourcesRef)) {
          entries = this.#snapshot.resources.map((resource) =>
            this.#entry(ref, this.#file(resource.ref)!, resource.ref.fileId),
          )
        } else if (sameFileRef(ref, this.toolsRef)) {
          entries = this.#snapshot.tools.map((tool) =>
            this.#entry(ref, this.#file(tool.ref)!, tool.ref.fileId),
          )
        } else {
          throw new FileSystemError(
            "not-found",
            `Connector directory not found: ${fileRefKey(ref)}`,
            ref,
          )
        }
        const page = paginateDirectoryItems(ref, entries, options)
        return { entries: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }
      },
      read: async (ref, ctx, options: FileReadOptions = {}) => {
        assertIntent(ref, ctx, "content")
        const resource = this.#snapshot.resourcesById.get(ref.fileId)
        if (resource) {
          if (resource.size !== undefined && resource.size > MAX_MCP_CONNECTOR_RESOURCE_BYTES) {
            throw new FileSystemError("unavailable", "Connector resource is too large", ref)
          }
          const client = this.#requireClient(ref)
          try {
            const result = await timeout(
              client.readResource(resource.uri),
              READ_TIMEOUT_MS,
              "MCP resources/read",
            )
            return resourcePayload(
              { ...resource, version: this.#resourceVersion(resource) },
              result,
              options,
            )
          } catch (error) {
            if (error instanceof FileSystemError) throw error
            throw new FileSystemError("offline", "Unable to read connector resource", ref)
          }
        }
        const tool = this.#snapshot.toolsById.get(ref.fileId)
        if (!tool)
          throw new FileSystemError(
            "not-found",
            `Connector file not found: ${fileRefKey(ref)}`,
            ref,
          )
        const document = {
          version: 1,
          type: "mcp-tool",
          title: tool.label,
          ...(tool.description ? { description: tool.description } : {}),
          risk: tool.risk,
          idempotent: tool.idempotent,
          input: tool.input ?? { type: "object", properties: {}, additionalProperties: false },
        }
        const text = JSON.stringify(document, null, 2)
        if ((options.encoding === undefined || options.encoding === "json") && options.range) {
          throw new FileSystemError("invalid-input", "JSON reads do not support byte ranges", ref)
        }
        if (options.encoding === undefined || options.encoding === "json") {
          return {
            data: document,
            mediaType: MCP_CONNECTOR_TOOL_MEDIA_TYPE,
            size: encodeText(text).byteLength,
            version: tool.version,
          }
        }
        return readBytes(
          ref,
          encodeText(text),
          MCP_CONNECTOR_TOOL_MEDIA_TYPE,
          tool.version,
          options,
        )
      },
      write: async (ref) => {
        throw new FileSystemError("unsupported", "Connector files are read-only", ref)
      },
      actions: async (ref, ctx): Promise<FileAction[]> => {
        assertUiAction(ref, ctx)
        const tool = this.#snapshot.toolsById.get(ref.fileId)
        if (!tool) return []
        return [
          {
            id: MCP_CONNECTOR_INVOKE_ACTION,
            label: "调用工具",
            kind: "invoke",
            risk: tool.risk,
            idempotent: tool.idempotent,
            ...(tool.input ? { input: tool.input } : {}),
            output: { type: "object", mediaType: "application/json" },
            uiHints: {
              submitLabel: "确认调用",
              confirmTitle: `调用“${tool.label}”`,
              confirmDescription:
                "参数不会写入审计记录。外部工具可能访问网络、文件或其它应用，请确认后继续。",
            },
          },
        ]
      },
      invoke: async (ref, action, input, ctx, options?: FileActionInvokeOptions) => {
        assertUiAction(ref, ctx)
        if (action !== MCP_CONNECTOR_INVOKE_ACTION) {
          throw new FileSystemError("unsupported", "Unsupported connector action", ref)
        }
        const tool = this.#snapshot.toolsById.get(ref.fileId)
        if (!tool) throw new FileSystemError("not-found", "Connector tool not found", ref)
        if (options?.expectedVersion !== undefined && options.expectedVersion !== tool.version) {
          throw new FileSystemError(
            "conflict",
            "Connector tool changed; review it before invoking",
            ref,
          )
        }
        const args = parseToolArgs(tool, input)
        const client = this.#requireClient(ref)
        let auditId: string
        try {
          auditId = await this.#audit.begin({
            extensionId: this.#options.extensionId,
            extensionLabel: this.#options.extensionLabel,
            toolId: tool.ref.fileId,
            toolLabel: tool.label,
          })
        } catch {
          throw new FileSystemError(
            "unavailable",
            "Unable to persist connector audit; the tool was not invoked",
            ref,
          )
        }
        let result: McpCallToolResult
        try {
          result = await timeout(
            client.callTool(tool.name, args),
            TOOL_TIMEOUT_MS,
            "MCP tools/call",
          )
        } catch {
          // transport/timeout 无法证明远端是否已经产生副作用；保留 pending，禁止自动重试。
          throw new FileSystemError(
            "conflict",
            "Connector tool result is unknown; its audit remains pending, so do not retry automatically",
            ref,
          )
        }
        const status = result.isError ? "failed" : "committed"
        try {
          await this.#audit.complete({ id: auditId, status })
        } catch {
          throw new FileSystemError(
            "conflict",
            "Connector tool returned, but its audit remains pending; do not retry automatically",
            ref,
          )
        }
        if (result.isError) {
          throw new FileSystemError("unavailable", "Connector tool returned an error", ref)
        }
        return toolResultSummary(result)
      },
      watch: (ref, ctx, notify): FileSystemWatchHandle | null => {
        assertIntent(ref, ctx, "watch")
        if (!this.#file(ref)) return null
        const watcher = { ref, notify }
        this.#watchers.add(watcher)
        return { dispose: () => this.#watchers.delete(watcher) }
      },
    }
  }

  #emit(event: FileSystemWatchEvent): void {
    for (const watcher of this.#watchers) {
      if (!sameFileRef(watcher.ref, event.ref) && !sameFileRef(watcher.ref, this.rootRef)) continue
      try {
        watcher.notify(event)
      } catch {}
    }
  }
}

export function createMcpConnectorFileSystem(
  options: McpConnectorFileSystemOptions,
): McpConnectorFileSystem {
  return new McpConnectorFileSystem(options)
}
