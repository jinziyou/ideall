import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  sameFileRef,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type {
  DirectoryPage,
  FileAction,
  FileReadOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchEvent,
  FileSystemWatchHandle,
  FileWriteInput,
  ReadDirectoryOptions,
} from "@/filesystem/types"
import { paginateDirectoryItems } from "@/filesystem/provider-input"
import { FileSystemError } from "@/filesystem/types"
import { withFileWriteLock } from "@/filesystem/write-lock"
import {
  AGENT_DATA_SPEC,
  AGENT_PUBLIC_CONFIG_SECTIONS,
  readAgentPublicConfigSection,
  sanitizeAgentPublicConfigSection,
  subscribeAgentPublicConfigSection,
  writeAgentPublicConfigSection,
  type AgentPublicConfigSectionId,
} from "./lib/agent-data-port"

export const AGENT_CONFIG_FILE_SYSTEM_ID = "app.agent-config"
export const AGENT_CONFIG_MEDIA_TYPE = "application/json"
export const AGENT_CONFIG_READ_PERMISSION = "agent.config:read"
export const AGENT_CONFIG_WRITE_PERMISSION = "agent.config:write"

export const agentConfigRootRef: FileRef = {
  fileSystemId: AGENT_CONFIG_FILE_SYSTEM_ID,
  fileId: "root",
}

export function agentConfigFileRef(section: AgentPublicConfigSectionId): FileRef {
  return {
    fileSystemId: AGENT_CONFIG_FILE_SYSTEM_ID,
    fileId: `config:${section}`,
  }
}

function sectionIdFromRef(ref: FileRef): AgentPublicConfigSectionId | null {
  if (ref.fileSystemId !== AGENT_CONFIG_FILE_SYSTEM_ID || !ref.fileId.startsWith("config:")) {
    return null
  }
  const candidate = ref.fileId.slice("config:".length)
  return AGENT_PUBLIC_CONFIG_SECTIONS.some((section) => section.id === candidate)
    ? (candidate as AgentPublicConfigSectionId)
    : null
}

const SOURCE = { kind: "app", id: "agent", label: "AI 智能体" } as const

export type AgentConfigFileSystemDeps = {
  read(section: AgentPublicConfigSectionId): unknown
  write(section: AgentPublicConfigSectionId, value: unknown): void | Promise<void>
  subscribe(section: AgentPublicConfigSectionId, listener: () => void): () => void
}

const defaultDeps: AgentConfigFileSystemDeps = {
  read: readAgentPublicConfigSection,
  write: writeAgentPublicConfigSection,
  subscribe: subscribeAgentPublicConfigSection,
}

type ConfigSnapshot = {
  value: unknown
  text: string
  bytes: Uint8Array
  version: string
}

function snapshot(
  section: AgentPublicConfigSectionId,
  deps: AgentConfigFileSystemDeps,
): ConfigSnapshot {
  const value = sanitizeAgentPublicConfigSection(section, deps.read(section))
  const text = JSON.stringify(value, null, 2) ?? "null"
  const bytes = new TextEncoder().encode(text)
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return {
    value,
    text,
    bytes,
    version: `1-${bytes.byteLength}-${(hash >>> 0).toString(16).padStart(8, "0")}`,
  }
}

function configFile(
  sectionId: AgentPublicConfigSectionId,
  deps: AgentConfigFileSystemDeps,
  includeContentMetadata = true,
): IdeallFile {
  const definition = AGENT_PUBLIC_CONFIG_SECTIONS.find((section) => section.id === sectionId)!
  const current = includeContentMetadata ? snapshot(sectionId, deps) : null
  return {
    ref: agentConfigFileRef(sectionId),
    kind: "file",
    name: definition.fileName,
    mediaType: AGENT_CONFIG_MEDIA_TYPE,
    capabilities: [
      "read",
      "write",
      "actions",
      "watch",
      "standalone-window",
      AGENT_CONFIG_READ_PERMISSION,
      AGENT_CONFIG_WRITE_PERMISSION,
    ],
    source: SOURCE,
    size: current?.bytes.byteLength,
    version: current?.version,
    properties: {
      configSection: sectionId,
      label: definition.label,
      dataKind: AGENT_DATA_SPEC.dataKind,
      dataVersion: AGENT_DATA_SPEC.dataVersion,
      publicConfig: true,
    },
  }
}

function hasPermission(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  permission:
    | "fs:read"
    | typeof AGENT_CONFIG_READ_PERMISSION
    | typeof AGENT_CONFIG_WRITE_PERMISSION,
): boolean {
  return (
    ctx.actor === "ui" ||
    (ctx.actor === "engine" && ctx.activeFile != null && sameFileRef(ref, ctx.activeFile)) ||
    ctx.permissions.includes(permission)
  )
}

function assertAccess(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  intent: "metadata" | "directory" | "content" | "write" | "action" | "watch",
  permission:
    | "fs:read"
    | typeof AGENT_CONFIG_READ_PERMISSION
    | typeof AGENT_CONFIG_WRITE_PERMISSION,
): void {
  if (ctx.intent !== intent) {
    throw new FileSystemError(
      "permission-denied",
      `The ${ctx.actor} actor requires ${intent} intent`,
      ref,
    )
  }
  if (hasPermission(ref, ctx, permission)) return
  throw new FileSystemError("permission-denied", `Missing ${permission} permission`, ref)
}

function readRange(ref: FileRef, bytes: Uint8Array, options: FileReadOptions): Uint8Array {
  const range = options.range
  if (!range) return bytes
  const end = range.end ?? bytes.byteLength
  if (
    !Number.isSafeInteger(range.start) ||
    range.start < 0 ||
    !Number.isSafeInteger(end) ||
    end < range.start
  ) {
    throw new FileSystemError("invalid-input", "Invalid Agent config read range", ref)
  }
  return bytes.slice(range.start, end)
}

async function parseWriteData(ref: FileRef, data: unknown): Promise<unknown> {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as unknown
    } catch {
      throw new FileSystemError("invalid-input", "Agent config must be valid JSON", ref)
    }
  }
  if (data instanceof Uint8Array) {
    return parseWriteData(ref, new TextDecoder().decode(data))
  }
  if (data instanceof ArrayBuffer) {
    return parseWriteData(ref, new TextDecoder().decode(new Uint8Array(data)))
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return parseWriteData(ref, await data.text())
  }
  if (data !== null && typeof data === "object") return data
  throw new FileSystemError("invalid-input", "Agent config must be JSON data", ref)
}

function assertExpectedVersion(
  ref: FileRef,
  expectedVersion: string | null | undefined,
  currentVersion: string,
): void {
  if (expectedVersion === undefined || expectedVersion === currentVersion) return
  throw new FileSystemError(
    "conflict",
    `Agent config changed (expected ${expectedVersion ?? "no version"}, current ${currentVersion})`,
    ref,
  )
}

export function createAgentConfigFileSystem(
  deps: AgentConfigFileSystemDeps = defaultDeps,
): FileSystemProvider {
  return {
    descriptor: {
      fileSystemId: AGENT_CONFIG_FILE_SYSTEM_ID,
      name: "AI 智能体配置",
      root: agentConfigRootRef,
      source: SOURCE,
      capabilities: [
        "read-directory",
        "read",
        "write",
        "actions",
        "watch",
        AGENT_CONFIG_READ_PERMISSION,
        AGENT_CONFIG_WRITE_PERMISSION,
      ],
    },
    async stat(ref, ctx) {
      assertAccess(ref, ctx, "metadata", "fs:read")
      if (sameFileRef(ref, agentConfigRootRef)) {
        return {
          ref,
          kind: "directory",
          name: "AI 智能体配置",
          mediaType: DIRECTORY_MEDIA_TYPE,
          capabilities: ["read-directory", "actions", "watch", AGENT_CONFIG_READ_PERMISSION],
          source: SOURCE,
          properties: {
            dataKind: AGENT_DATA_SPEC.dataKind,
            dataVersion: AGENT_DATA_SPEC.dataVersion,
            publicConfig: true,
          },
        }
      }
      const section = sectionIdFromRef(ref)
      return section
        ? configFile(section, deps, hasPermission(ref, ctx, AGENT_CONFIG_READ_PERMISSION))
        : null
    },
    async readDirectory(ref, ctx, options: ReadDirectoryOptions = {}): Promise<DirectoryPage> {
      assertAccess(ref, ctx, "directory", "fs:read")
      if (!sameFileRef(ref, agentConfigRootRef)) {
        throw new FileSystemError("unsupported", "Agent config file is not a directory", ref)
      }
      const page = paginateDirectoryItems(ref, AGENT_PUBLIC_CONFIG_SECTIONS, options)
      return {
        entries: page.items.map((section, index) => ({
          entryId: section.id,
          parent: agentConfigRootRef,
          target: agentConfigFileRef(section.id),
          name: section.fileName,
          kind: "child",
          sortKey: String(page.offset + index).padStart(3, "0"),
          properties: { configSection: section.id, label: section.label, publicConfig: true },
        })),
        nextCursor: page.nextCursor,
      }
    },
    async read(ref, ctx, options: FileReadOptions = {}): Promise<FileReadResult> {
      assertAccess(ref, ctx, "content", AGENT_CONFIG_READ_PERMISSION)
      const section = sectionIdFromRef(ref)
      if (!section) {
        if (sameFileRef(ref, agentConfigRootRef)) {
          throw new FileSystemError("unsupported", "Agent config root has no file content", ref)
        }
        throw new FileSystemError("not-found", `Agent config not found: ${fileRefKey(ref)}`, ref)
      }
      const current = snapshot(section, deps)
      if ((options.encoding === undefined || options.encoding === "json") && options.range) {
        throw new FileSystemError("invalid-input", "JSON reads do not support byte ranges", ref)
      }
      if (options.encoding === undefined || options.encoding === "json") {
        return {
          data: current.value,
          mediaType: AGENT_CONFIG_MEDIA_TYPE,
          size: current.bytes.byteLength,
          version: current.version,
        }
      }
      const bytes = readRange(ref, current.bytes, options)
      return {
        data: options.encoding === "binary" ? bytes : new TextDecoder().decode(bytes),
        mediaType: AGENT_CONFIG_MEDIA_TYPE,
        size: bytes.byteLength,
        version: current.version,
      }
    },
    async write(ref, input: FileWriteInput, ctx): Promise<IdeallFile> {
      assertAccess(ref, ctx, "write", AGENT_CONFIG_WRITE_PERMISSION)
      const section = sectionIdFromRef(ref)
      if (!section) {
        if (sameFileRef(ref, agentConfigRootRef)) {
          throw new FileSystemError("unsupported", "Agent config root is not writable", ref)
        }
        throw new FileSystemError("not-found", `Agent config not found: ${fileRefKey(ref)}`, ref)
      }
      if (input.mediaType && input.mediaType !== AGENT_CONFIG_MEDIA_TYPE) {
        throw new FileSystemError(
          "invalid-input",
          "Agent config writes require application/json",
          ref,
        )
      }
      return withFileWriteLock(ref, async () => {
        const current = snapshot(section, deps)
        assertExpectedVersion(ref, input.expectedVersion, current.version)
        const value = await parseWriteData(ref, input.data)
        try {
          await deps.write(section, value)
        } catch (error) {
          if (error instanceof FileSystemError) throw error
          throw new FileSystemError(
            "invalid-input",
            error instanceof Error ? error.message : String(error),
            ref,
          )
        }
        return configFile(section, deps)
      })
    },
    async actions(ref, ctx): Promise<FileAction[]> {
      assertAccess(ref, ctx, "action", "fs:read")
      if (sameFileRef(ref, agentConfigRootRef)) return []
      const section = sectionIdFromRef(ref)
      if (!section) throw new FileSystemError("not-found", "Agent config not found", ref)
      return [{ id: "open", label: "打开", kind: "display" }]
    },
    async invoke(ref, action, _input, ctx): Promise<unknown> {
      assertAccess(ref, ctx, "action", "fs:read")
      const section = sectionIdFromRef(ref)
      if (!section) throw new FileSystemError("not-found", "Agent config not found", ref)
      if (action === "open") return { ref }
      throw new FileSystemError("unsupported", `Unsupported Agent config action: ${action}`, ref)
    },
    watch(ref, ctx, notify): FileSystemWatchHandle | null {
      assertAccess(ref, ctx, "watch", AGENT_CONFIG_READ_PERMISSION)
      const watchedSections = sameFileRef(ref, agentConfigRootRef)
        ? AGENT_PUBLIC_CONFIG_SECTIONS.map((section) => section.id)
        : (() => {
            const section = sectionIdFromRef(ref)
            return section ? [section] : []
          })()
      if (!watchedSections.length) return null
      const disposers: Array<() => void> = []
      try {
        for (const section of watchedSections) {
          disposers.push(
            deps.subscribe(section, () => {
              let version: string | undefined
              const sectionRef = agentConfigFileRef(section)
              if (hasPermission(sectionRef, ctx, AGENT_CONFIG_READ_PERMISSION)) {
                try {
                  version = snapshot(section, deps).version
                } catch {
                  // 数据源暂不可读时仍发送失效事件，由下一次 stat/read 给出结构化错误。
                }
              }
              const event: FileSystemWatchEvent = {
                type: "changed",
                ref: sectionRef,
                entryId: section,
                oldParent: agentConfigRootRef,
                newParent: agentConfigRootRef,
                ...(version ? { version } : {}),
              }
              try {
                notify(event)
              } catch {}
            }),
          )
        }
      } catch (error) {
        // root 需同时订阅全部 section；部分建立失败必须回滚，且每个 disposer 相互隔离。
        for (const dispose of disposers.reverse()) {
          try {
            dispose()
          } catch {}
        }
        throw error
      }
      let disposed = false
      return {
        dispose: () => {
          if (disposed) return
          disposed = true
          for (const dispose of disposers.splice(0).reverse()) {
            try {
              dispose()
            } catch {}
          }
        },
      }
    },
  }
}

export const agentConfigFileSystem = createAgentConfigFileSystem()

let mounted: (() => void) | null = null

export function registerAgentConfigFileSystem(
  mount: (provider: FileSystemProvider) => () => void,
): () => void {
  if (mounted) return () => {}
  const dispose = mount(agentConfigFileSystem)
  mounted = dispose
  return () => {
    if (mounted !== dispose) return
    mounted = null
    dispose()
  }
}
