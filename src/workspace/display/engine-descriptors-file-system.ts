import type { FileRef, IdeallFile } from "@protocol/file-system"
import { DIRECTORY_MEDIA_TYPE, fileRefKey, sameFileRef } from "@protocol/file-system"
import type { EngineDescriptor } from "@protocol/engine"
import { ENGINES_FILE_SYSTEM_ID, ENGINES_ROOT_REF } from "@/filesystem/builtin-app-roots"
import { FileSystemError } from "@/filesystem/types"
import type {
  DirectoryPage,
  FileReadOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchEvent,
  FileSystemWatchHandle,
  ReadDirectoryOptions,
} from "@/filesystem/types"
import { engineRegistry } from "@/engines/builtin"
import { sha256SemanticVersion } from "@/lib/semantic-version"

/**
 * `app.engines`：Engine 描述符的只读投影（Desktop Entry 系统层类比，docs/freedesktop-alignment.md §5）。
 * descriptor 全量为公开元数据（engineId/label/match/priority/layout/access/iconHint），
 * 不含 renderer 代码——renderer 注册仍只能经组合根 / 签名 runtime-extension 管线，
 * 文件投影绝不构成第二注册通道。write/invoke 一律 unsupported。
 */

const SOURCE = {
  kind: "app",
  id: "engines",
  label: "Engine 描述符",
  readOnly: true,
} as const

const DESCRIPTOR_MEDIA_TYPE = "application/json"
const ENGINE_FILE_ID_PREFIX = "engine:"

function engineFileRef(engineId: string): FileRef {
  return { fileSystemId: ENGINES_FILE_SYSTEM_ID, fileId: `${ENGINE_FILE_ID_PREFIX}${engineId}` }
}

function engineIdFromRef(ref: FileRef): string | null {
  if (ref.fileSystemId !== ENGINES_FILE_SYSTEM_ID) return null
  if (!ref.fileId.startsWith(ENGINE_FILE_ID_PREFIX)) return null
  const engineId = ref.fileId.slice(ENGINE_FILE_ID_PREFIX.length)
  return engineId.length > 0 ? engineId : null
}

function engineFileName(engineId: string): string {
  return `${engineId}.json`
}

function assertReadAccess(ref: FileRef, ctx: FileSystemAccessContext, intent: string): void {
  if (ctx.intent !== intent) {
    throw new FileSystemError(
      "permission-denied",
      `The ${ctx.actor} actor requires ${intent} intent`,
      ref,
    )
  }
  if (ctx.actor === "ui" || ctx.permissions.includes("fs:read")) return
  if (ctx.actor === "engine" && ctx.activeFile && sameFileRef(ctx.activeFile, ref)) return
  throw new FileSystemError("permission-denied", "Missing fs:read permission", ref)
}

type EngineDescriptorSnapshot = Readonly<{
  text: string
  bytes: Uint8Array
  version: string
}>

async function snapshotDescriptor(descriptor: EngineDescriptor): Promise<EngineDescriptorSnapshot> {
  const text = JSON.stringify({ version: 1, descriptor }, null, 2)
  return {
    text,
    bytes: new TextEncoder().encode(text),
    version: await sha256SemanticVersion("display-engine-descriptors-v1", text),
  }
}

function descriptorFile(engineId: string, current?: EngineDescriptorSnapshot): IdeallFile {
  return {
    ref: engineFileRef(engineId),
    kind: "file",
    name: engineFileName(engineId),
    mediaType: DESCRIPTOR_MEDIA_TYPE,
    capabilities: ["read", "watch"],
    source: SOURCE,
    size: current?.bytes.byteLength,
    version: current?.version,
    properties: { engineDescriptor: engineId, synthetic: true },
  }
}

function readRange(ref: FileRef, bytes: Uint8Array, options: FileReadOptions): Uint8Array {
  if (!options.range) return bytes
  const { start, end = bytes.byteLength } = options.range
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < start) {
    throw new FileSystemError("invalid-input", "Invalid engine descriptor read range", ref)
  }
  return bytes.slice(start, end)
}

export function createEngineDescriptorsFileSystem(): FileSystemProvider {
  const watchers = new Set<(events: readonly FileSystemWatchEvent[]) => void>()
  let registryDisposer: (() => void) | null = null
  let lastKnown: ReadonlyMap<string, EngineDescriptor> = new Map()

  const dispatchRegistryChange = () => {
    const next = new Map(
      engineRegistry.list().map((descriptor) => [descriptor.engineId, descriptor]),
    )
    const events: FileSystemWatchEvent[] = []
    for (const [engineId] of lastKnown) {
      if (!next.has(engineId)) {
        events.push({ type: "deleted", ref: engineFileRef(engineId), oldParent: ENGINES_ROOT_REF })
      }
    }
    for (const [engineId, descriptor] of next) {
      const previous = lastKnown.get(engineId)
      if (previous === undefined) {
        events.push({ type: "created", ref: engineFileRef(engineId), newParent: ENGINES_ROOT_REF })
      } else if (previous !== descriptor) {
        events.push({ type: "changed", ref: engineFileRef(engineId) })
      }
    }
    lastKnown = next
    if (events.length === 0) return
    for (const notify of watchers) {
      try {
        notify(events)
      } catch {}
    }
  }

  const subscribeRegistry = () => {
    if (registryDisposer) return
    lastKnown = new Map(
      engineRegistry.list().map((descriptor) => [descriptor.engineId, descriptor]),
    )
    registryDisposer = engineRegistry.subscribe(dispatchRegistryChange)
  }

  const releaseRegistryIfIdle = () => {
    if (watchers.size > 0 || !registryDisposer) return
    try {
      registryDisposer()
    } finally {
      registryDisposer = null
      lastKnown = new Map()
    }
  }

  return {
    descriptor: {
      fileSystemId: ENGINES_FILE_SYSTEM_ID,
      name: "Engine 描述符",
      root: ENGINES_ROOT_REF,
      source: SOURCE,
      capabilities: ["read-directory", "read", "watch"],
    },
    async stat(ref, ctx) {
      assertReadAccess(ref, ctx, "metadata")
      if (sameFileRef(ref, ENGINES_ROOT_REF)) {
        return {
          ref,
          kind: "directory",
          name: "Engine 描述符",
          mediaType: DIRECTORY_MEDIA_TYPE,
          capabilities: ["read-directory", "watch"],
          source: SOURCE,
          properties: { enginesRoot: true, synthetic: true },
        }
      }
      const engineId = engineIdFromRef(ref)
      if (!engineId) return null
      const descriptor = engineRegistry.get(engineId)
      if (!descriptor) return null
      return descriptorFile(engineId, await snapshotDescriptor(descriptor))
    },
    async readDirectory(ref, ctx, options: ReadDirectoryOptions = {}): Promise<DirectoryPage> {
      assertReadAccess(ref, ctx, "directory")
      if (!sameFileRef(ref, ENGINES_ROOT_REF)) {
        throw new FileSystemError("unsupported", "Engine descriptor file is not a directory", ref)
      }
      const limit = options.limit ?? 200
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 500) {
        throw new FileSystemError("invalid-input", "Invalid engines directory limit", ref)
      }
      let offset = 0
      if (options.cursor !== undefined) {
        offset = Number.parseInt(options.cursor, 10)
        if (!Number.isSafeInteger(offset) || offset < 0 || String(offset) !== options.cursor) {
          throw new FileSystemError("invalid-input", "Unknown engines directory cursor", ref)
        }
      }
      const descriptors = engineRegistry.list()
      const page = descriptors.slice(offset, offset + limit)
      const nextOffset = offset + page.length
      return {
        entries: page.map((descriptor, index) => ({
          entryId: descriptor.engineId,
          parent: ENGINES_ROOT_REF,
          target: engineFileRef(descriptor.engineId),
          name: engineFileName(descriptor.engineId),
          pathName: engineFileName(descriptor.engineId),
          kind: "child",
          sortKey: String(offset + index).padStart(5, "0"),
          file: descriptorFile(descriptor.engineId),
          properties: { engineDescriptor: descriptor.engineId },
        })),
        ...(nextOffset < descriptors.length ? { nextCursor: String(nextOffset) } : {}),
      }
    },
    async read(ref, ctx, options: FileReadOptions = {}): Promise<FileReadResult> {
      assertReadAccess(ref, ctx, "content")
      if (sameFileRef(ref, ENGINES_ROOT_REF)) {
        throw new FileSystemError("unsupported", "Engines root has no file content", ref)
      }
      const engineId = engineIdFromRef(ref)
      const descriptor = engineId ? engineRegistry.get(engineId) : null
      if (!engineId || !descriptor) {
        throw new FileSystemError(
          "not-found",
          `Engine descriptor not found: ${fileRefKey(ref)}`,
          ref,
        )
      }
      if ((options.encoding === undefined || options.encoding === "json") && options.range) {
        throw new FileSystemError("invalid-input", "JSON reads do not support byte ranges", ref)
      }
      const current = await snapshotDescriptor(descriptor)
      if (options.encoding === undefined || options.encoding === "json") {
        return {
          data: { version: 1, descriptor },
          mediaType: DESCRIPTOR_MEDIA_TYPE,
          size: current.bytes.byteLength,
          version: current.version,
        }
      }
      const bytes = readRange(ref, current.bytes, options)
      return {
        data: options.encoding === "binary" ? bytes : new TextDecoder().decode(bytes),
        mediaType: DESCRIPTOR_MEDIA_TYPE,
        size: bytes.byteLength,
        version: current.version,
      }
    },
    async write(ref) {
      throw new FileSystemError(
        "unsupported",
        "Engine descriptors are read-only projections; renderer registration stays in the signed runtime-extension pipeline",
        ref,
      )
    },
    async actions() {
      return []
    },
    async invoke(ref) {
      throw new FileSystemError("unsupported", "Engine descriptors have no actions", ref)
    },
    watch(ref, ctx, notify): FileSystemWatchHandle | null {
      assertReadAccess(ref, ctx, "watch")
      const watchRoot = sameFileRef(ref, ENGINES_ROOT_REF)
      const engineId = engineIdFromRef(ref)
      if (!watchRoot && !engineId) return null
      const listener = (events: readonly FileSystemWatchEvent[]) => {
        for (const event of events) {
          if (!watchRoot && engineFileRefMatches(event, engineId!) === false) continue
          try {
            notify(event)
          } catch {}
        }
      }
      watchers.add(listener)
      try {
        subscribeRegistry()
      } catch (error) {
        watchers.delete(listener)
        throw error
      }
      let disposed = false
      return {
        dispose: () => {
          if (disposed) return
          disposed = true
          watchers.delete(listener)
          releaseRegistryIfIdle()
        },
      }
    },
  }
}

function engineFileRefMatches(event: FileSystemWatchEvent, engineId: string): boolean {
  return sameFileRef(event.ref, engineFileRef(engineId))
}

export const engineDescriptorsFileSystem = createEngineDescriptorsFileSystem()

export const engineDescriptorsFileSystemContribution = {
  provider: engineDescriptorsFileSystem,
  mount: {
    entryId: ENGINES_FILE_SYSTEM_ID,
    name: "Engine 描述符",
    properties: { navigationHidden: true },
  },
}
