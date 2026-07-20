import type { FileRef, IdeallFile } from "@protocol/file-system"
import { DIRECTORY_MEDIA_TYPE, fileRefKey, sameFileRef } from "@protocol/file-system"
import {
  DISPLAY_ENGINES_FILE_REF,
  DISPLAY_FILE_SYSTEM_ID,
  DISPLAY_ROOT_REF,
} from "@/filesystem/builtin-app-roots"
import { FileSystemError } from "@/filesystem/types"
import type {
  DirectoryPage,
  FileAction,
  FileReadOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchHandle,
  FileWriteInput,
  ReadDirectoryOptions,
} from "@/filesystem/types"
import { withFileWriteLock } from "@/filesystem/write-lock"
import {
  enginePreferencesStorageKey,
  parseEnginePreferences,
  readEnginePreferences,
  withEngineAssociationRemoved,
  withEngineAssociationRestored,
  withFileEnginePreference,
  withMediaTypeEnginePreference,
  writeEnginePreferences,
  type EnginePreferenceScope,
  type EnginePreferences,
} from "@/engines/preferences"
import { sha256SemanticVersion } from "@/lib/semantic-version"
import {
  DISPLAY_ENGINES_FILE_NAME,
  DISPLAY_ENGINES_MEDIA_TYPE,
  DISPLAY_ENGINES_REMOVE_ASSOCIATION_ACTION,
  DISPLAY_ENGINES_RESTORE_ASSOCIATION_ACTION,
  DISPLAY_ENGINES_SCOPES,
  DISPLAY_ENGINES_SET_FILE_DEFAULT_ACTION,
  DISPLAY_ENGINES_SET_MEDIA_TYPE_DEFAULT_ACTION,
  DISPLAY_ENGINES_STORAGE_KEYS,
  DISPLAY_ENGINES_WRITE_PERMISSION,
  decodeDisplayEnginesDocument,
  decodeMediaTypeActionInput,
  decodeSetFileDefaultInput,
  scopeDocument,
} from "./display-engines-file-contract"

/**
 * `app.display`：Engine 关联（mimeapps.list 形状）的 config 类投影（docs/freedesktop-alignment.md §4）。
 * localStorage 仍是物理真相（engines/preferences 领域 store），engines.json 是同一 store 的
 * CAS 投影；单 scope 变更经 specialized action 提交（单一 setItem），完整文档经 write CAS。
 */

const SOURCE = {
  kind: "app",
  id: "display",
  label: "Engine 关联",
  readOnly: false,
} as const

export type DisplayEnginesFileSystemDeps = Readonly<{
  read(scope: EnginePreferenceScope): EnginePreferences
  write(scope: EnginePreferenceScope, preferences: EnginePreferences): boolean
  subscribe(listener: () => void): () => void
}>

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

const defaultDeps: DisplayEnginesFileSystemDeps = {
  read: (scope) => readEnginePreferences(safeLocalStorage(), enginePreferencesStorageKey(scope)),
  write: (scope, preferences) =>
    writeEnginePreferences(safeLocalStorage(), preferences, enginePreferencesStorageKey(scope)),
  subscribe: (listener) => {
    if (typeof window === "undefined") return () => {}
    const handler = (event: StorageEvent) => {
      if (event.key === null || DISPLAY_ENGINES_STORAGE_KEYS.has(event.key)) listener()
    }
    window.addEventListener("storage", handler)
    return () => window.removeEventListener("storage", handler)
  },
}

type DisplayEnginesSnapshot = Readonly<{
  document: unknown
  text: string
  bytes: Uint8Array
  version: string
}>

async function snapshot(deps: DisplayEnginesFileSystemDeps): Promise<DisplayEnginesSnapshot> {
  const document = {
    version: 2,
    scopes: Object.fromEntries(
      DISPLAY_ENGINES_SCOPES.map((scope) => [scope, scopeDocument(deps.read(scope))]),
    ),
  }
  const text = JSON.stringify(document, null, 2)
  return {
    document,
    text,
    bytes: new TextEncoder().encode(text),
    version: await sha256SemanticVersion("display-engine-associations-v1", text),
  }
}

/** 语义等价比较（键序与屏蔽列表顺序无关），供 diff 提交与 changed 判定。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).sort().join(",")}]`
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function preferencesEqual(left: EnginePreferences, right: EnginePreferences): boolean {
  return (
    canonicalJson(left.files) === canonicalJson(right.files) &&
    canonicalJson(left.mediaTypes) === canonicalJson(right.mediaTypes) &&
    canonicalJson(left.removed) === canonicalJson(right.removed)
  )
}

function enginesFile(current?: DisplayEnginesSnapshot): IdeallFile {
  return {
    ref: DISPLAY_ENGINES_FILE_REF,
    kind: "file",
    name: DISPLAY_ENGINES_FILE_NAME,
    mediaType: DISPLAY_ENGINES_MEDIA_TYPE,
    capabilities: ["read", "write", "actions", "watch"],
    source: SOURCE,
    size: current?.bytes.byteLength,
    version: current?.version,
    properties: { displayEngines: true, synthetic: true },
  }
}

function hasReadAccess(ref: FileRef, ctx: FileSystemAccessContext): boolean {
  return (
    ctx.actor === "ui" ||
    (ctx.actor === "engine" && ctx.activeFile != null && sameFileRef(ref, ctx.activeFile)) ||
    ctx.permissions.includes("fs:read")
  )
}

function hasWriteAccess(ref: FileRef, ctx: FileSystemAccessContext): boolean {
  return (
    ctx.actor === "ui" ||
    (ctx.actor === "engine" && ctx.activeFile != null && sameFileRef(ref, ctx.activeFile)) ||
    ctx.permissions.includes(DISPLAY_ENGINES_WRITE_PERMISSION)
  )
}

function assertAccess(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  intent: "metadata" | "directory" | "content" | "write" | "action" | "watch",
): void {
  if (ctx.intent !== intent) {
    throw new FileSystemError(
      "permission-denied",
      `The ${ctx.actor} actor requires ${intent} intent`,
      ref,
    )
  }
  if (intent === "write") {
    if (hasWriteAccess(ref, ctx)) return
    throw new FileSystemError(
      "permission-denied",
      `Missing ${DISPLAY_ENGINES_WRITE_PERMISSION} permission`,
      ref,
    )
  }
  if (hasReadAccess(ref, ctx)) return
  throw new FileSystemError("permission-denied", "Missing fs:read permission", ref)
}

function assertMutationAccess(ref: FileRef, ctx: FileSystemAccessContext): void {
  if (ctx.intent !== "action") {
    throw new FileSystemError(
      "permission-denied",
      `The ${ctx.actor} actor requires action intent`,
      ref,
    )
  }
  if (hasWriteAccess(ref, ctx)) return
  throw new FileSystemError(
    "permission-denied",
    `Missing ${DISPLAY_ENGINES_WRITE_PERMISSION} permission`,
    ref,
  )
}

function assertEnginesRef(ref: FileRef): void {
  if (!sameFileRef(ref, DISPLAY_ENGINES_FILE_REF)) {
    throw new FileSystemError(
      "not-found",
      `Display engines file not found: ${fileRefKey(ref)}`,
      ref,
    )
  }
}

function readRange(ref: FileRef, bytes: Uint8Array, options: FileReadOptions): Uint8Array {
  if (!options.range) return bytes
  const { start, end = bytes.byteLength } = options.range
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < start) {
    throw new FileSystemError("invalid-input", "Invalid display engines read range", ref)
  }
  return bytes.slice(start, end)
}

async function parseWriteJson(ref: FileRef, data: unknown): Promise<unknown> {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as unknown
    } catch {
      throw new FileSystemError("invalid-input", "Display engines write must be valid JSON", ref)
    }
  }
  if (data instanceof Uint8Array) return parseWriteJson(ref, new TextDecoder().decode(data))
  if (data instanceof ArrayBuffer) {
    return parseWriteJson(ref, new TextDecoder().decode(new Uint8Array(data)))
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return parseWriteJson(ref, await data.text())
  }
  if (data !== null && typeof data === "object") return data
  throw new FileSystemError("invalid-input", "Display engines write must be JSON data", ref)
}

function assertExpectedVersion(
  ref: FileRef,
  expectedVersion: string | null | undefined,
  currentVersion: string,
): void {
  if (expectedVersion === undefined || expectedVersion === currentVersion) return
  throw new FileSystemError(
    "conflict",
    `Display engines changed (expected ${expectedVersion ?? "no version"}, current ${currentVersion})`,
    ref,
  )
}

const MUTATION_ACTIONS: readonly FileAction[] = [
  {
    id: DISPLAY_ENGINES_SET_FILE_DEFAULT_ACTION,
    label: "设为该文件默认引擎",
    kind: "invoke",
    risk: "safe",
    idempotent: true,
    input: {
      type: "object",
      properties: {
        scope: { type: "string", enum: [...DISPLAY_ENGINES_SCOPES] },
        fileRef: { type: "string", title: "FileRef key" },
        engineId: { type: "string", title: "引擎 id（空表示清除）" },
      },
      required: ["scope", "fileRef", "engineId"],
    },
  },
  {
    id: DISPLAY_ENGINES_SET_MEDIA_TYPE_DEFAULT_ACTION,
    label: "设为该类型默认引擎",
    kind: "invoke",
    risk: "safe",
    idempotent: true,
    input: {
      type: "object",
      properties: {
        scope: { type: "string", enum: [...DISPLAY_ENGINES_SCOPES] },
        mediaType: { type: "string", title: "媒体类型" },
        engineId: { type: "string", title: "引擎 id（空表示清除）" },
      },
      required: ["scope", "mediaType", "engineId"],
    },
  },
  {
    id: DISPLAY_ENGINES_REMOVE_ASSOCIATION_ACTION,
    label: "不再用此引擎打开该类型",
    kind: "invoke",
    risk: "caution",
    idempotent: true,
    input: {
      type: "object",
      properties: {
        scope: { type: "string", enum: [...DISPLAY_ENGINES_SCOPES] },
        mediaType: { type: "string", title: "媒体类型" },
        engineId: { type: "string", title: "引擎 id" },
      },
      required: ["scope", "mediaType", "engineId"],
    },
  },
  {
    id: DISPLAY_ENGINES_RESTORE_ASSOCIATION_ACTION,
    label: "恢复引擎关联",
    kind: "invoke",
    risk: "safe",
    idempotent: true,
    input: {
      type: "object",
      properties: {
        scope: { type: "string", enum: [...DISPLAY_ENGINES_SCOPES] },
        mediaType: { type: "string", title: "媒体类型" },
        engineId: { type: "string", title: "引擎 id" },
      },
      required: ["scope", "mediaType", "engineId"],
    },
  },
]

export function createDisplayEnginesFileSystem(
  deps: DisplayEnginesFileSystemDeps = defaultDeps,
): FileSystemProvider {
  const watchers = new Set<() => void>()
  let sourceDisposer: (() => void) | null = null
  let notificationPending = false

  const scheduleNotification = () => {
    if (notificationPending) return
    notificationPending = true
    queueMicrotask(() => {
      notificationPending = false
      for (const notify of watchers) {
        try {
          notify()
        } catch {}
      }
    })
  }

  const subscribeSource = () => {
    if (sourceDisposer) return
    sourceDisposer = deps.subscribe(scheduleNotification)
  }

  const releaseSourceIfIdle = () => {
    if (watchers.size > 0 || !sourceDisposer) return
    try {
      sourceDisposer()
    } finally {
      sourceDisposer = null
    }
  }

  const commitScope = (scope: EnginePreferenceScope, next: EnginePreferences): boolean => {
    const current = deps.read(scope)
    if (preferencesEqual(current, next)) return false
    if (!deps.write(scope, next)) {
      throw new FileSystemError(
        "offline",
        "Display engines preferences are unavailable",
        DISPLAY_ENGINES_FILE_REF,
      )
    }
    return true
  }

  return {
    descriptor: {
      fileSystemId: DISPLAY_FILE_SYSTEM_ID,
      name: "Engine 关联",
      root: DISPLAY_ROOT_REF,
      source: SOURCE,
      capabilities: ["read-directory", "read", "write", "actions", "watch"],
    },
    async stat(ref, ctx) {
      assertAccess(ref, ctx, "metadata")
      if (sameFileRef(ref, DISPLAY_ROOT_REF)) {
        return {
          ref,
          kind: "directory",
          name: "Engine 关联",
          mediaType: DIRECTORY_MEDIA_TYPE,
          capabilities: ["read-directory", "watch"],
          source: SOURCE,
          properties: { displayRoot: true, synthetic: true },
        }
      }
      if (!sameFileRef(ref, DISPLAY_ENGINES_FILE_REF)) return null
      return enginesFile(hasReadAccess(ref, ctx) ? await snapshot(deps) : undefined)
    },
    async readDirectory(ref, ctx, options: ReadDirectoryOptions = {}): Promise<DirectoryPage> {
      assertAccess(ref, ctx, "directory")
      if (!sameFileRef(ref, DISPLAY_ROOT_REF)) {
        throw new FileSystemError("unsupported", "Display engines file is not a directory", ref)
      }
      if (options.cursor) {
        throw new FileSystemError("invalid-input", "Unknown display directory cursor", ref)
      }
      return {
        entries: [
          {
            entryId: DISPLAY_ENGINES_FILE_REF.fileId,
            parent: DISPLAY_ROOT_REF,
            target: DISPLAY_ENGINES_FILE_REF,
            name: DISPLAY_ENGINES_FILE_NAME,
            pathName: DISPLAY_ENGINES_FILE_NAME,
            kind: "child",
            sortKey: "000",
            file: enginesFile(),
            properties: { displayEngines: true },
          },
        ],
      }
    },
    async read(ref, ctx, options: FileReadOptions = {}): Promise<FileReadResult> {
      assertAccess(ref, ctx, "content")
      if (sameFileRef(ref, DISPLAY_ROOT_REF)) {
        throw new FileSystemError("unsupported", "Display root has no file content", ref)
      }
      assertEnginesRef(ref)
      if ((options.encoding === undefined || options.encoding === "json") && options.range) {
        throw new FileSystemError("invalid-input", "JSON reads do not support byte ranges", ref)
      }
      const current = await snapshot(deps)
      if (options.encoding === undefined || options.encoding === "json") {
        return {
          data: current.document,
          mediaType: DISPLAY_ENGINES_MEDIA_TYPE,
          size: current.bytes.byteLength,
          version: current.version,
        }
      }
      const bytes = readRange(ref, current.bytes, options)
      return {
        data: options.encoding === "binary" ? bytes : new TextDecoder().decode(bytes),
        mediaType: DISPLAY_ENGINES_MEDIA_TYPE,
        size: bytes.byteLength,
        version: current.version,
      }
    },
    async write(ref, input: FileWriteInput, ctx): Promise<IdeallFile> {
      assertAccess(ref, ctx, "write")
      assertEnginesRef(ref)
      if (input.mediaType && input.mediaType !== DISPLAY_ENGINES_MEDIA_TYPE) {
        throw new FileSystemError(
          "invalid-input",
          "Display engines writes require application/json",
          ref,
        )
      }
      return withFileWriteLock(DISPLAY_ENGINES_FILE_REF, async () => {
        const current = await snapshot(deps)
        assertExpectedVersion(ref, input.expectedVersion, current.version)
        const document = decodeDisplayEnginesDocument(await parseWriteJson(ref, input.data))
        if (!document) {
          throw new FileSystemError(
            "invalid-input",
            "Display engines document must be { version: 2, scopes: { files, audio, development } }",
            ref,
          )
        }
        // 按 scope diff 提交：单 scope 变更 = 单一 setItem（与现状同级；不承诺跨 scope 原子）。
        let changed = false
        for (const scope of DISPLAY_ENGINES_SCOPES) {
          const next = parseEnginePreferences(
            JSON.stringify({ version: 2, ...document.scopes[scope] }),
          )
          changed = commitScope(scope, next) || changed
        }
        if (changed) scheduleNotification()
        return enginesFile(await snapshot(deps))
      })
    },
    async actions(ref, ctx): Promise<FileAction[]> {
      assertAccess(ref, ctx, "action")
      assertEnginesRef(ref)
      return [...MUTATION_ACTIONS]
    },
    async invoke(ref, action, input, ctx): Promise<unknown> {
      assertMutationAccess(ref, ctx)
      assertEnginesRef(ref)
      return withFileWriteLock(DISPLAY_ENGINES_FILE_REF, async () => {
        let scope: EnginePreferenceScope
        let mutate: (current: EnginePreferences) => EnginePreferences
        if (action === DISPLAY_ENGINES_SET_FILE_DEFAULT_ACTION) {
          const decoded = decodeSetFileDefaultInput(input)
          if (!decoded)
            throw new FileSystemError("invalid-input", "Invalid setFileDefault input", ref)
          scope = decoded.scope
          mutate = (current) => withFileEnginePreference(current, decoded.ref, decoded.engineId)
        } else if (action === DISPLAY_ENGINES_SET_MEDIA_TYPE_DEFAULT_ACTION) {
          const decoded = decodeMediaTypeActionInput(input)
          if (!decoded) {
            throw new FileSystemError("invalid-input", "Invalid setMediaTypeDefault input", ref)
          }
          scope = decoded.scope
          mutate = (current) =>
            withMediaTypeEnginePreference(current, decoded.mediaType, decoded.engineId)
        } else if (action === DISPLAY_ENGINES_REMOVE_ASSOCIATION_ACTION) {
          const decoded = decodeMediaTypeActionInput(input)
          if (!decoded || decoded.engineId === null) {
            throw new FileSystemError("invalid-input", "Invalid removeAssociation input", ref)
          }
          scope = decoded.scope
          const engineId = decoded.engineId
          mutate = (current) => withEngineAssociationRemoved(current, decoded.mediaType, engineId)
        } else if (action === DISPLAY_ENGINES_RESTORE_ASSOCIATION_ACTION) {
          const decoded = decodeMediaTypeActionInput(input)
          if (!decoded || decoded.engineId === null) {
            throw new FileSystemError("invalid-input", "Invalid restoreAssociation input", ref)
          }
          scope = decoded.scope
          const engineId = decoded.engineId
          mutate = (current) => withEngineAssociationRestored(current, decoded.mediaType, engineId)
        } else {
          throw new FileSystemError("unsupported", `Unknown display engines action: ${action}`, ref)
        }
        const changed = commitScope(scope, mutate(deps.read(scope)))
        if (changed) scheduleNotification()
        return { changed, version: (await snapshot(deps)).version }
      })
    },
    watch(ref, ctx, notify): FileSystemWatchHandle | null {
      assertAccess(ref, ctx, "watch")
      if (!sameFileRef(ref, DISPLAY_ROOT_REF) && !sameFileRef(ref, DISPLAY_ENGINES_FILE_REF)) {
        return null
      }
      const listener = () => {
        try {
          notify({ type: "changed", ref: DISPLAY_ENGINES_FILE_REF })
        } catch {}
      }
      watchers.add(listener)
      try {
        subscribeSource()
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
          releaseSourceIfIdle()
        },
      }
    },
  }
}

export const displayEnginesFileSystem = createDisplayEnginesFileSystem()

export const displayEnginesFileSystemContribution = {
  provider: displayEnginesFileSystem,
  mount: {
    entryId: DISPLAY_FILE_SYSTEM_ID,
    name: "Engine 关联",
    properties: { navigationHidden: true },
  },
}
