import { fileRefKey, sameFileRef, type FileRef, type IdeallFile } from "@protocol/file-system"
import { getSession, subscribeSession } from "@protocol/auth"
import { paginateDirectoryItems } from "@/filesystem/provider-input"
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
import { FileSystemError } from "@/filesystem/types"
import { sha256SemanticVersion } from "@/lib/semantic-version"
import { getSyncCode, subscribeSyncCode } from "@/lib/sync-code"
import { getThemeChoice, setThemeChoice, subscribeThemeChoice } from "@/lib/theme"
import {
  getConnectionsSnapshot,
  revokeConnection,
  subscribeConnections,
} from "@/plugins/embed/connections"
import {
  runtimeExtensionCatalog,
  type RuntimeExtensionCatalogState,
} from "@/shell/runtime-extensions"
import {
  SETTINGS_CONNECTION_REVOKE_ACTION,
  SETTINGS_FILE_SYSTEM_ID,
  SETTINGS_READ_PERMISSION,
  SETTINGS_ROOT_MEDIA_TYPE,
  SETTINGS_ROOT_REF,
  SETTINGS_RUNTIME_ACTIONS,
  SETTINGS_RUNTIME_RETRY_ACTION,
  SETTINGS_RUNTIME_REVOKE_ACTION,
  SETTINGS_RUNTIME_UNINSTALL_ACTION,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTION_MEDIA_TYPE,
  SETTINGS_WRITE_PERMISSION,
  settingsSectionFileRef,
  type SettingsRuntimeAction,
  type SettingsSectionId,
  type SettingsThemeChoice,
} from "./settings-contract"
import { withSettingsSectionMutationLock } from "./settings-write-adapter"

export {
  SETTINGS_CONNECTION_REVOKE_ACTION,
  SETTINGS_FILE_SYSTEM_ID,
  SETTINGS_READ_PERMISSION,
  SETTINGS_ROOT_MEDIA_TYPE,
  SETTINGS_ROOT_REF,
  SETTINGS_RUNTIME_RETRY_ACTION,
  SETTINGS_RUNTIME_REVOKE_ACTION,
  SETTINGS_RUNTIME_UNINSTALL_ACTION,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTION_MEDIA_TYPE,
  SETTINGS_WRITE_PERMISSION,
  settingsSectionFileRef,
}
export type { SettingsRuntimeAction, SettingsSectionId, SettingsThemeChoice }

type SettingsSectionDefinition = Readonly<{
  id: SettingsSectionId
  fileName: string
  label: string
  writable: boolean
}>

const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  { id: "appearance", fileName: "appearance.json", label: "外观", writable: true },
  { id: "device", fileName: "device.json", label: "本机状态", writable: false },
  {
    id: "connections",
    fileName: "connections.json",
    label: "已连接应用",
    writable: false,
  },
  {
    id: "runtime-extensions",
    fileName: "runtime-extensions.json",
    label: "运行时扩展",
    writable: false,
  },
]

const SOURCE = { kind: "app", id: "settings", label: "ideall 设置" } as const

export const settingsRootRef = SETTINGS_ROOT_REF

function sectionIdFromRef(ref: FileRef): SettingsSectionId | null {
  if (ref.fileSystemId !== SETTINGS_FILE_SYSTEM_ID || !ref.fileId.startsWith("section:")) {
    return null
  }
  const candidate = ref.fileId.slice("section:".length)
  return SETTINGS_SECTION_IDS.includes(candidate as SettingsSectionId)
    ? (candidate as SettingsSectionId)
    : null
}

type MaybePromise<T> = T | Promise<T>

export type SettingsFileSystemDeps = Readonly<{
  read(section: SettingsSectionId): MaybePromise<unknown>
  writeAppearance(choice: SettingsThemeChoice): MaybePromise<void>
  revokeConnection(id: string): MaybePromise<boolean>
  manageRuntimeExtension(action: SettingsRuntimeAction, id: string): MaybePromise<boolean>
  subscribe(section: SettingsSectionId, listener: () => void): () => void
}>

const REDACTED_DIAGNOSTIC = "[redacted]"
const MAX_DIAGNOSTIC_LENGTH = 1024
const MAX_DIAGNOSTIC_DEPTH = 5
const MAX_DIAGNOSTIC_ENTRIES = 32
const SENSITIVE_DIAGNOSTIC_KEY =
  /(token|secret|api[-_]?key|authorization|auth|cookie|password|session|jwt|bearer|credential|refresh|sync[:_-]?code)/i
const COMMAND_DIAGNOSTIC_KEY = /^(args?|argv|command|cmd|headers?)$/i

function redactDiagnosticString(value: string): string {
  const bounded =
    value.length > MAX_DIAGNOSTIC_LENGTH ? `${value.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…` : value
  const withoutUrlQueries = bounded.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const url = new URL(candidate)
      const base = `${url.origin}${url.pathname}`
      if (url.search) return `${base}?[redacted]`
      if (url.hash) return `${base}#[redacted]`
      return base
    } catch {
      return candidate.replace(/\?[^\s#]*/u, "?[redacted]").replace(/#[^\s]*/u, "#[redacted]")
    }
  })
  const redacted = withoutUrlQueries
    .replace(/(\b(?:Bearer|Basic)\s+)(?!\[redacted\])[^\s,"'<>]+/gi, `$1${REDACTED_DIAGNOSTIC}`)
    .replace(
      /((?:^|\s)(?:-H|--header|--data|--config|--token|--secret|--api[-_]?key|--password|--authorization|--cookie)\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      `$1${REDACTED_DIAGNOSTIC}`,
    )
    .replace(
      /(\b(?:token|secret|api[-_]?key|authorization|cookie|password|credential|sync[:_-]?code)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      `$1${REDACTED_DIAGNOSTIC}`,
    )
  return redacted.length > MAX_DIAGNOSTIC_LENGTH
    ? `${redacted.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`
    : redacted
}

/** 把不可信诊断压缩成有界、无循环、无常见凭证与命令参数的 JSON 安全值。 */
export function sanitizeSettingsDiagnostic(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (typeof value === "string") return redactDiagnosticString(value)
  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "bigint") return String(value)
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return "[unavailable]"
  }
  if (depth >= MAX_DIAGNOSTIC_DEPTH) return "[truncated]"
  if (seen.has(value)) return "[circular]"
  seen.add(value)

  if (value instanceof Error) {
    return {
      name: redactDiagnosticString(value.name),
      message: redactDiagnosticString(value.message),
    }
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DIAGNOSTIC_ENTRIES)
      .map((item) => sanitizeSettingsDiagnostic(item, seen, depth + 1))
  }

  const result: Record<string, unknown> = {}
  let entries: Array<[string, unknown]>
  try {
    entries = Object.entries(value).slice(0, MAX_DIAGNOSTIC_ENTRIES)
  } catch {
    return "[unavailable]"
  }
  for (const [key, inner] of entries) {
    result[key] =
      SENSITIVE_DIAGNOSTIC_KEY.test(key) || COMMAND_DIAGNOSTIC_KEY.test(key)
        ? REDACTED_DIAGNOSTIC
        : sanitizeSettingsDiagnostic(inner, seen, depth + 1)
  }
  return result
}

export function settingsDiagnosticMessage(failure: unknown): string | null {
  if (failure == null) return null
  const safe = sanitizeSettingsDiagnostic(failure)
  let text: string
  try {
    text = typeof safe === "string" ? safe : (JSON.stringify(safe) ?? "[unavailable]")
  } catch {
    text = "[unavailable]"
  }
  return text.length > MAX_DIAGNOSTIC_LENGTH ? `${text.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…` : text
}

export function settingsRuntimeExtensionSnapshot(state: RuntimeExtensionCatalogState) {
  return {
    id: state.id,
    label: state.label,
    version: state.version,
    source: state.source ? { kind: state.source.kind, id: state.source.id } : null,
    permissions: [...state.permissions],
    digest: state.digest,
    permissionDigest: state.permissionDigest,
    desired: state.desired,
    health: state.health,
    failure: settingsDiagnosticMessage(state.failure),
    pendingCleanup: state.pendingCleanup.map(redactDiagnosticString),
  }
}

function subscribeAppearance(listener: () => void): () => void {
  const disposeThemeChoice = subscribeThemeChoice(listener)
  if (typeof window === "undefined") return disposeThemeChoice
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === "ideall:theme" || event.key === "wonita-theme") {
      listener()
    }
  }
  window.addEventListener("storage", onStorage)
  const observer =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver((records) => {
          if (records.some((record) => record.attributeName === "class")) listener()
        })
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => {
    window.removeEventListener("storage", onStorage)
    observer?.disconnect()
    disposeThemeChoice()
  }
}

function combineSubscriptions(...subscribe: Array<(listener: () => void) => () => void>) {
  return (listener: () => void): (() => void) => {
    const disposers: Array<() => void> = []
    try {
      for (const source of subscribe) disposers.push(source(listener))
    } catch (error) {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {}
      }
      throw error
    }
    return () => {
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          dispose()
        } catch {}
      }
    }
  }
}

async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === "undefined") return null
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate) return null
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  } catch {
    return null
  }
}

const defaultDeps: SettingsFileSystemDeps = {
  async read(section) {
    switch (section) {
      case "appearance":
        return {
          choice: getThemeChoice(),
          effectiveColorScheme:
            typeof document === "undefined"
              ? null
              : document.documentElement.classList.contains("dark")
                ? "dark"
                : "light",
        }
      case "device": {
        const session = getSession()
        return {
          sync: { enabled: Boolean(getSyncCode()) },
          storage: await storageEstimate(),
          publishingIdentity: session
            ? {
                signedIn: true,
                user: {
                  id: session.user.id,
                  email: session.user.email,
                  name: session.user.name,
                  avatar: session.user.avatar,
                },
              }
            : { signedIn: false, user: null },
        }
      }
      case "connections":
        return getConnectionsSnapshot().map((connection) => ({
          id: connection.id,
          appId: connection.appId,
          name: connection.name,
          origin: connection.origin,
          permissions: [...connection.permissions],
          grantedAt: connection.grantedAt,
        }))
      case "runtime-extensions":
        return runtimeExtensionCatalog.states().map(settingsRuntimeExtensionSnapshot)
    }
  },
  writeAppearance: setThemeChoice,
  revokeConnection(id) {
    const connected = getConnectionsSnapshot().some((connection) => connection.id === id)
    if (connected) revokeConnection(id)
    return connected
  },
  manageRuntimeExtension(action, id) {
    switch (action) {
      case SETTINGS_RUNTIME_RETRY_ACTION:
        return runtimeExtensionCatalog.retry(id)
      case SETTINGS_RUNTIME_REVOKE_ACTION:
        return runtimeExtensionCatalog.revoke(id)
      case SETTINGS_RUNTIME_UNINSTALL_ACTION:
        return runtimeExtensionCatalog.uninstall(id)
    }
  },
  subscribe(section, listener) {
    switch (section) {
      case "appearance":
        return subscribeAppearance(listener)
      case "device":
        return combineSubscriptions(subscribeSyncCode, subscribeSession)(listener)
      case "connections":
        return subscribeConnections(listener)
      case "runtime-extensions":
        return runtimeExtensionCatalog.subscribe(listener)
    }
  },
}

type SettingsSnapshot = Readonly<{
  value: unknown
  text: string
  bytes: Uint8Array
  version: string
}>

async function snapshot(
  section: SettingsSectionId,
  deps: SettingsFileSystemDeps,
): Promise<SettingsSnapshot> {
  let text: string
  try {
    text = JSON.stringify(await deps.read(section), null, 2) ?? "null"
  } catch (error) {
    throw new FileSystemError(
      "invalid-input",
      `Settings section ${section} is not serializable: ${
        error instanceof Error ? error.message : String(error)
      }`,
      settingsSectionFileRef(section),
    )
  }
  const bytes = new TextEncoder().encode(text)
  return {
    value: JSON.parse(text) as unknown,
    text,
    bytes,
    version: await sha256SemanticVersion("settings-v2", text),
  }
}

function sectionFile(section: SettingsSectionId, current?: SettingsSnapshot): IdeallFile {
  const definition = SETTINGS_SECTIONS.find((item) => item.id === section)!
  return {
    ref: settingsSectionFileRef(section),
    kind: "file",
    name: definition.fileName,
    mediaType: SETTINGS_SECTION_MEDIA_TYPE,
    capabilities: [
      "read",
      ...(definition.writable ? (["write"] as const) : []),
      "actions",
      "watch",
    ],
    source: SOURCE,
    size: current?.bytes.byteLength,
    version: current?.version,
    properties: {
      settingsSection: section,
      label: definition.label,
      synthetic: true,
    },
  }
}

function hasPermission(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  permission: "fs:read" | typeof SETTINGS_READ_PERMISSION | typeof SETTINGS_WRITE_PERMISSION,
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
  permission: "fs:read" | typeof SETTINGS_READ_PERMISSION | typeof SETTINGS_WRITE_PERMISSION,
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
  if (!options.range) return bytes
  const { start, end = bytes.byteLength } = options.range
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < start) {
    throw new FileSystemError("invalid-input", "Invalid settings read range", ref)
  }
  return bytes.slice(start, end)
}

async function parseWriteData(ref: FileRef, data: unknown): Promise<unknown> {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as unknown
    } catch {
      throw new FileSystemError("invalid-input", "Settings write must be valid JSON", ref)
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
  throw new FileSystemError("invalid-input", "Settings write must be JSON data", ref)
}

function appearanceChoice(ref: FileRef, value: unknown): SettingsThemeChoice {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new FileSystemError("invalid-input", "Appearance settings require an object", ref)
  }
  const choice = (value as { choice?: unknown }).choice
  if (choice === "light" || choice === "dark" || choice === "system") return choice
  throw new FileSystemError(
    "invalid-input",
    "Appearance choice must be light, dark, or system",
    ref,
  )
}

function assertSettingsMutationAccess(ref: FileRef, ctx: FileSystemAccessContext): void {
  if (ctx.intent !== "action") {
    throw new FileSystemError(
      "permission-denied",
      `The ${ctx.actor} actor requires action intent`,
      ref,
    )
  }
  if (ctx.actor === "ui" || ctx.permissions.includes(SETTINGS_WRITE_PERMISSION)) return
  throw new FileSystemError(
    "permission-denied",
    `Missing ${SETTINGS_WRITE_PERMISSION} permission`,
    ref,
  )
}

function settingsActionTargetId(ref: FileRef, input: unknown): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new FileSystemError("invalid-input", "Settings action input must be an object", ref)
  }
  let keys: string[]
  let id: unknown
  try {
    keys = Object.keys(input)
    id = (input as { id?: unknown }).id
  } catch {
    throw new FileSystemError("invalid-input", "Settings action input is unavailable", ref)
  }
  if (
    keys.length !== 1 ||
    keys[0] !== "id" ||
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 512 ||
    id !== id.trim() ||
    /[\u0000-\u001f\u007f]/.test(id)
  ) {
    throw new FileSystemError("invalid-input", "Settings action requires one bounded id", ref)
  }
  return id
}

const OPEN_SETTINGS_ACTION = { id: "open", label: "打开", kind: "display" } as const

const CONNECTION_SETTINGS_ACTIONS: readonly FileAction[] = [
  OPEN_SETTINGS_ACTION,
  {
    id: SETTINGS_CONNECTION_REVOKE_ACTION,
    label: "撤销应用授权",
    kind: "specialized",
    reason: "需要从当前连接快照中选择目标实例并确认吊销。",
    risk: "destructive",
    requires: [SETTINGS_WRITE_PERMISSION],
  },
]

const RUNTIME_EXTENSION_SETTINGS_ACTIONS: readonly FileAction[] = [
  OPEN_SETTINGS_ACTION,
  {
    id: SETTINGS_RUNTIME_RETRY_ACTION,
    label: "重试运行时扩展",
    kind: "specialized",
    reason: "需要结合扩展当前信任与清理状态选择目标。",
    risk: "caution",
    requires: [SETTINGS_WRITE_PERMISSION],
  },
  {
    id: SETTINGS_RUNTIME_REVOKE_ACTION,
    label: "撤销运行时扩展授权",
    kind: "specialized",
    reason: "需要结合扩展来源与授权状态选择目标并确认。",
    risk: "destructive",
    requires: [SETTINGS_WRITE_PERMISSION],
  },
  {
    id: SETTINGS_RUNTIME_UNINSTALL_ACTION,
    label: "卸载运行时扩展",
    kind: "specialized",
    reason: "需要选择目标扩展并确认卸载。",
    risk: "destructive",
    requires: [SETTINGS_WRITE_PERMISSION],
  },
]

function assertExpectedVersion(
  ref: FileRef,
  expectedVersion: string | null | undefined,
  currentVersion: string,
): void {
  if (expectedVersion === undefined || expectedVersion === currentVersion) return
  throw new FileSystemError(
    "conflict",
    `Settings changed (expected ${expectedVersion ?? "no version"}, current ${currentVersion})`,
    ref,
  )
}

export function createSettingsFileSystem(
  deps: SettingsFileSystemDeps = defaultDeps,
): FileSystemProvider {
  const watchers = new Map<SettingsSectionId, Set<() => void>>()
  const sourceDisposers = new Map<SettingsSectionId, () => void>()
  const pendingNotifications = new Set<SettingsSectionId>()

  const scheduleNotification = (section: SettingsSectionId) => {
    if (pendingNotifications.has(section)) return
    pendingNotifications.add(section)
    queueMicrotask(() => {
      pendingNotifications.delete(section)
      for (const notify of watchers.get(section) ?? []) {
        try {
          notify()
        } catch {}
      }
    })
  }

  const watchSection = (section: SettingsSectionId, notify: () => void): (() => void) => {
    let listeners = watchers.get(section)
    if (!listeners) {
      listeners = new Set()
      watchers.set(section, listeners)
    }
    listeners.add(notify)
    if (listeners.size === 1) {
      try {
        sourceDisposers.set(
          section,
          deps.subscribe(section, () => scheduleNotification(section)),
        )
      } catch (error) {
        listeners.delete(notify)
        watchers.delete(section)
        throw error
      }
    }
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const current = watchers.get(section)
      current?.delete(notify)
      if (current?.size) return
      watchers.delete(section)
      try {
        sourceDisposers.get(section)?.()
      } finally {
        sourceDisposers.delete(section)
      }
    }
  }

  return {
    descriptor: {
      fileSystemId: SETTINGS_FILE_SYSTEM_ID,
      name: "ideall 设置",
      root: settingsRootRef,
      source: SOURCE,
      capabilities: [
        "read-directory",
        "read",
        "write",
        "actions",
        "watch",
        SETTINGS_READ_PERMISSION,
        SETTINGS_WRITE_PERMISSION,
      ],
    },
    async stat(ref, ctx) {
      assertAccess(ref, ctx, "metadata", "fs:read")
      if (sameFileRef(ref, settingsRootRef)) {
        return {
          ref,
          kind: "directory",
          name: "基本设置",
          mediaType: SETTINGS_ROOT_MEDIA_TYPE,
          capabilities: ["read-directory", "actions", "watch", SETTINGS_READ_PERMISSION],
          source: SOURCE,
          properties: { settingsRoot: true, synthetic: true },
        }
      }
      const section = sectionIdFromRef(ref)
      return section
        ? sectionFile(
            section,
            hasPermission(ref, ctx, SETTINGS_READ_PERMISSION)
              ? await snapshot(section, deps)
              : undefined,
          )
        : null
    },
    async readDirectory(ref, ctx, options: ReadDirectoryOptions = {}): Promise<DirectoryPage> {
      assertAccess(ref, ctx, "directory", "fs:read")
      if (!sameFileRef(ref, settingsRootRef)) {
        throw new FileSystemError("unsupported", "Settings section is not a directory", ref)
      }
      const page = paginateDirectoryItems(ref, SETTINGS_SECTIONS, options)
      return {
        entries: page.items.map((section, index) => ({
          entryId: section.id,
          parent: settingsRootRef,
          target: settingsSectionFileRef(section.id),
          name: section.fileName,
          pathName: section.fileName,
          kind: "child",
          sortKey: String(page.offset + index).padStart(3, "0"),
          file: sectionFile(section.id),
          properties: { settingsSection: section.id, label: section.label },
        })),
        nextCursor: page.nextCursor,
      }
    },
    async read(ref, ctx, options: FileReadOptions = {}): Promise<FileReadResult> {
      assertAccess(ref, ctx, "content", SETTINGS_READ_PERMISSION)
      const section = sectionIdFromRef(ref)
      if (!section) {
        if (sameFileRef(ref, settingsRootRef)) {
          throw new FileSystemError("unsupported", "Settings root has no file content", ref)
        }
        throw new FileSystemError(
          "not-found",
          `Settings section not found: ${fileRefKey(ref)}`,
          ref,
        )
      }
      const current = await snapshot(section, deps)
      if ((options.encoding === undefined || options.encoding === "json") && options.range) {
        throw new FileSystemError("invalid-input", "JSON reads do not support byte ranges", ref)
      }
      if (options.encoding === undefined || options.encoding === "json") {
        return {
          data: current.value,
          mediaType: SETTINGS_SECTION_MEDIA_TYPE,
          size: current.bytes.byteLength,
          version: current.version,
        }
      }
      const bytes = readRange(ref, current.bytes, options)
      return {
        data: options.encoding === "binary" ? bytes : new TextDecoder().decode(bytes),
        mediaType: SETTINGS_SECTION_MEDIA_TYPE,
        size: bytes.byteLength,
        version: current.version,
      }
    },
    async write(ref, input: FileWriteInput, ctx): Promise<IdeallFile> {
      assertAccess(ref, ctx, "write", SETTINGS_WRITE_PERMISSION)
      const section = sectionIdFromRef(ref)
      if (!section) {
        if (sameFileRef(ref, settingsRootRef)) {
          throw new FileSystemError("unsupported", "Settings root is not writable", ref)
        }
        throw new FileSystemError(
          "not-found",
          `Settings section not found: ${fileRefKey(ref)}`,
          ref,
        )
      }
      if (section !== "appearance") {
        throw new FileSystemError("unsupported", `${section} settings are read-only`, ref)
      }
      if (input.mediaType && input.mediaType !== SETTINGS_SECTION_MEDIA_TYPE) {
        throw new FileSystemError("invalid-input", "Settings writes require application/json", ref)
      }
      return withSettingsSectionMutationLock(section, async () => {
        const current = await snapshot(section, deps)
        assertExpectedVersion(ref, input.expectedVersion, current.version)
        const choice = appearanceChoice(ref, await parseWriteData(ref, input.data))
        try {
          await deps.writeAppearance(choice)
        } catch (error) {
          if (error instanceof FileSystemError) throw error
          throw new FileSystemError(
            "offline",
            `Appearance settings are unavailable: ${settingsDiagnosticMessage(error) ?? "unknown error"}`,
            ref,
          )
        }
        scheduleNotification(section)
        return sectionFile(section, await snapshot(section, deps))
      })
    },
    async actions(ref, ctx): Promise<FileAction[]> {
      assertAccess(ref, ctx, "action", "fs:read")
      if (sameFileRef(ref, settingsRootRef)) return []
      const section = sectionIdFromRef(ref)
      if (!section) throw new FileSystemError("not-found", "Settings section not found", ref)
      if (section === "connections") return [...CONNECTION_SETTINGS_ACTIONS]
      if (section === "runtime-extensions") return [...RUNTIME_EXTENSION_SETTINGS_ACTIONS]
      return [OPEN_SETTINGS_ACTION]
    },
    async invoke(ref, action, input, ctx, options): Promise<unknown> {
      const section = sectionIdFromRef(ref)
      if (!section) throw new FileSystemError("not-found", "Settings section not found", ref)
      if (action === "open") {
        assertAccess(ref, ctx, "action", "fs:read")
        return { ref }
      }

      assertSettingsMutationAccess(ref, ctx)
      const id = settingsActionTargetId(ref, input)
      const connectionMutation =
        section === "connections" && action === SETTINGS_CONNECTION_REVOKE_ACTION
      const runtimeMutation =
        section === "runtime-extensions" &&
        SETTINGS_RUNTIME_ACTIONS.includes(action as SettingsRuntimeAction)
      if (!connectionMutation && !runtimeMutation) {
        throw new FileSystemError("unsupported", `Unsupported settings action: ${action}`, ref)
      }
      return withSettingsSectionMutationLock(section, async () => {
        const current = await snapshot(section, deps)
        assertExpectedVersion(ref, options?.expectedVersion, current.version)
        let changed: boolean
        try {
          changed = connectionMutation
            ? await deps.revokeConnection(id)
            : await deps.manageRuntimeExtension(action as SettingsRuntimeAction, id)
        } catch (error) {
          if (error instanceof FileSystemError) throw error
          throw new FileSystemError(
            "unavailable",
            `Settings action failed: ${settingsDiagnosticMessage(error) ?? "unknown error"}`,
            ref,
          )
        }
        if (changed) scheduleNotification(section)
        return { changed: Boolean(changed) }
      })
    },
    watch(ref, ctx, notify): FileSystemWatchHandle | null {
      const watchesRoot = sameFileRef(ref, settingsRootRef)
      if (watchesRoot) {
        if (ctx.intent !== "watch") {
          throw new FileSystemError(
            "permission-denied",
            `The ${ctx.actor} actor requires watch intent`,
            ref,
          )
        }
        if (ctx.actor !== "ui" && !ctx.permissions.includes(SETTINGS_READ_PERMISSION)) {
          throw new FileSystemError(
            "permission-denied",
            `Root settings watch requires ${SETTINGS_READ_PERMISSION} permission`,
            ref,
          )
        }
      } else {
        // 精确 active-file 例外仅适用于叶文件，不能借 root 聚合观察私密状态时序。
        assertAccess(ref, ctx, "watch", SETTINGS_READ_PERMISSION)
      }
      const sections = watchesRoot
        ? SETTINGS_SECTION_IDS
        : (() => {
            const section = sectionIdFromRef(ref)
            return section ? ([section] as const) : []
          })()
      if (!sections.length) return null
      const disposers: Array<() => void> = []
      try {
        for (const section of sections) {
          disposers.push(
            watchSection(section, () => {
              const event: FileSystemWatchEvent = {
                type: "changed",
                ref: settingsSectionFileRef(section),
                entryId: section,
                oldParent: settingsRootRef,
                newParent: settingsRootRef,
              }
              try {
                notify(event)
              } catch {}
            }),
          )
        }
      } catch (error) {
        for (const dispose of disposers.reverse()) {
          try {
            dispose()
          } catch {}
        }
        throw error
      }
      let disposed = false
      return {
        dispose() {
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

export const settingsFileSystem = createSettingsFileSystem()

export const settingsFileSystemContribution = {
  provider: settingsFileSystem,
  mount: {
    entryId: SETTINGS_FILE_SYSTEM_ID,
    name: "ideall 设置",
    properties: { navigationHidden: true },
  },
} as const
