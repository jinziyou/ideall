import type { FileRef } from "@protocol/file-system"
import {
  SETTINGS_FILE_SYSTEM_ID,
  SETTINGS_ROOT_MEDIA_TYPE,
  SETTINGS_ROOT_REF,
} from "@/filesystem/builtin-app-roots"

export { SETTINGS_FILE_SYSTEM_ID, SETTINGS_ROOT_MEDIA_TYPE, SETTINGS_ROOT_REF }

export const SETTINGS_SECTION_MEDIA_TYPE = "application/json"
export const SETTINGS_READ_PERMISSION = "settings:read"
export const SETTINGS_WRITE_PERMISSION = "settings:write"

export const SETTINGS_SECTION_IDS = [
  "appearance",
  "device",
  "data",
  "connections",
  "runtime-extensions",
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

export const SETTINGS_CONNECTION_REVOKE_ACTION = "revoke-connection"
export const SETTINGS_DATA_EXPORT_ACTION = "export-workspace-archive"
export const SETTINGS_DATA_PREVIEW_IMPORT_ACTION = "preview-workspace-archive-import"
export const SETTINGS_DATA_IMPORT_ACTION = "import-workspace-archive"
export const SETTINGS_DATA_PERSIST_ACTION = "request-persistent-storage"
export const SETTINGS_DATA_SECURE_STORE_SELF_TEST_ACTION = "self-test-secure-store"
export const SETTINGS_DATA_MIGRATE_SECURE_STORE_ACTION = "migrate-legacy-secure-values"
export const SETTINGS_RUNTIME_RETRY_ACTION = "retry-extension"
export const SETTINGS_RUNTIME_REVOKE_ACTION = "revoke-extension"
export const SETTINGS_RUNTIME_UNINSTALL_ACTION = "uninstall-extension"

export const SETTINGS_RUNTIME_ACTIONS = [
  SETTINGS_RUNTIME_RETRY_ACTION,
  SETTINGS_RUNTIME_REVOKE_ACTION,
  SETTINGS_RUNTIME_UNINSTALL_ACTION,
] as const

export type SettingsRuntimeAction = (typeof SETTINGS_RUNTIME_ACTIONS)[number]
export type SettingsThemeChoice = "light" | "dark" | "system"
export type SettingsEffectiveColorScheme = "light" | "dark" | null

export type AppearanceSettingsDocument = Readonly<{
  choice: SettingsThemeChoice
  effectiveColorScheme: SettingsEffectiveColorScheme
}>

export type DeviceSettingsDocument = Readonly<{
  sync: Readonly<{
    enabled: boolean
    lastRun: Readonly<{
      status: "success" | "failure"
      finishedAt: number
      durationMs: number
      total: number | null
      added: number | null
      failureCode: "block-limit" | "conflict" | "decrypt" | "network" | "unknown" | null
    }> | null
  }>
  storage: Readonly<{ usage: number; quota: number }> | null
  publishingIdentity:
    | Readonly<{
        signedIn: true
        user: Readonly<{
          id: number
          email: string
          name: string
          avatar: string | null
        }>
      }>
    | Readonly<{ signedIn: false; user: null }>
}>

export type DataSettingsDocument = Readonly<{
  archive: Readonly<{
    kind: string
    version: number
    includesSecrets: false
    importMode: "replace"
  }>
  secureStore: Readonly<{
    backend: "system-keychain" | "web-localStorage" | "unavailable"
    native: boolean
    fallbackValueCount: number
    legacyValueCount: number
    error: string | null
  }>
  database: Readonly<{
    name: string
    version: number
    status: "healthy" | "unavailable"
    counts: Readonly<{
      nodes: number
      blobs: number
      trashSnapshots: number
      agentTasks: number
    }> | null
    error: string | null
  }>
  storage: Readonly<{
    persistenceAvailable: boolean
    persisted: boolean | null
  }>
}>

export type SettingsDataArchiveCounts = Readonly<{
  nodeCount: number
  blobCount: number
  trashSnapshotCount: number
  pluginCount: number
  tabCount: number
}>

export type SettingsDataExportResult = Readonly<{
  filename: string
  content: string
  encrypted: boolean
}>

export type SettingsDataImportPreview = Readonly<{
  ok: boolean
  encrypted: boolean
  requiresPassphrase: boolean
  filename: string | null
  error: string | null
  package: Readonly<{
    kind: string
    version: number
    exportedAt: string
  }> | null
  archive: SettingsDataArchiveCounts | null
}>

export type SettingsDataImportResult = Readonly<{
  changed: boolean
  reloadRequired: boolean
  imported: Readonly<{
    nodes: number
    blobs: number
    trash: number
    plugins: number
  }>
}>

export type SettingsDataPersistenceResult = Readonly<{
  available: boolean
  granted: boolean
}>

export type SettingsDataSecureStoreSelfTestResult = Readonly<{
  backend: "system-keychain"
  roundTrip: true
  cleanedUp: true
}>

export type SettingsDataSecureStoreMigrationResult = Readonly<{
  available: boolean
  migrated: number
  removedPlaintext: number
  failed: number
  remaining: number
}>

export type SettingsConnectionDocument = Readonly<{
  id: string
  appId: string
  name: string
  origin: string
  permissions: readonly string[]
  grantedAt: number
}>

export type RuntimeExtensionSettingsHealth =
  | "discovered"
  | "verifying"
  | "verified"
  | "consent-required"
  | "ready"
  | "activating"
  | "active"
  | "tearing-down"
  | "degraded"
  | "quarantined"
  | "revoked"
  | "unavailable"

export type RuntimeExtensionSettingsDocument = Readonly<{
  id: string
  label: string
  version: number
  source: Readonly<{ kind: "builtin" | "package"; id: string }> | null
  permissions: readonly string[]
  digest: string
  permissionDigest: string
  desired: boolean
  health: RuntimeExtensionSettingsHealth
  failure: string | null
  pendingCleanup: readonly string[]
}>

export type SettingsMutationResult = Readonly<{ changed: boolean }>

export type SettingsDocumentBySection = Readonly<{
  appearance: AppearanceSettingsDocument
  device: DeviceSettingsDocument
  data: DataSettingsDocument
  connections: readonly SettingsConnectionDocument[]
  "runtime-extensions": readonly RuntimeExtensionSettingsDocument[]
}>

export function settingsSectionFileRef(section: SettingsSectionId): FileRef {
  return {
    fileSystemId: SETTINGS_FILE_SYSTEM_ID,
    fileId: `section:${section}`,
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, maxLength = 4096): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new TypeError(`${label} must be a bounded string`)
  }
  return value
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number`)
  }
  return value
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
  return value as number
}

function textArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 4096) throw new TypeError(`${label} must be an array`)
  return value.map((item) => text(item, `${label} item`, 1024))
}

export function decodeAppearanceSettings(value: unknown): AppearanceSettingsDocument {
  const candidate = record(value, "Appearance settings")
  const choice = candidate.choice
  const effective = candidate.effectiveColorScheme
  if (choice !== "light" && choice !== "dark" && choice !== "system") {
    throw new TypeError("Appearance choice is invalid")
  }
  if (effective !== "light" && effective !== "dark" && effective !== null) {
    throw new TypeError("Effective color scheme is invalid")
  }
  return { choice, effectiveColorScheme: effective }
}

export function decodeDeviceSettings(value: unknown): DeviceSettingsDocument {
  const candidate = record(value, "Device settings")
  const sync = record(candidate.sync, "Device sync settings")
  if (typeof sync.enabled !== "boolean") throw new TypeError("Device sync state is invalid")
  const lastRun: DeviceSettingsDocument["sync"]["lastRun"] =
    sync.lastRun === null
      ? null
      : (() => {
          const item = record(sync.lastRun, "Last sync telemetry")
          if (item.status !== "success" && item.status !== "failure") {
            throw new TypeError("Last sync status is invalid")
          }
          const status = item.status
          const total = item.total === null ? null : integer(item.total, "Last sync total")
          const added = item.added === null ? null : integer(item.added, "Last sync added")
          const failureCode = item.failureCode
          if (
            failureCode !== null &&
            failureCode !== "block-limit" &&
            failureCode !== "conflict" &&
            failureCode !== "decrypt" &&
            failureCode !== "network" &&
            failureCode !== "unknown"
          ) {
            throw new TypeError("Last sync failure code is invalid")
          }
          return {
            status,
            finishedAt: integer(item.finishedAt, "Last sync finished time"),
            durationMs: integer(item.durationMs, "Last sync duration"),
            total,
            added,
            failureCode,
          }
        })()

  const storageValue = candidate.storage
  const storage =
    storageValue === null
      ? null
      : (() => {
          const item = record(storageValue, "Device storage estimate")
          return {
            usage: finiteNumber(item.usage, "Device storage usage"),
            quota: finiteNumber(item.quota, "Device storage quota"),
          }
        })()

  const identity = record(candidate.publishingIdentity, "Publishing identity")
  if (identity.signedIn === false && identity.user === null) {
    return {
      sync: { enabled: sync.enabled, lastRun },
      storage,
      publishingIdentity: { signedIn: false, user: null },
    }
  }
  if (identity.signedIn !== true) throw new TypeError("Publishing identity state is invalid")
  const user = record(identity.user, "Publishing identity user")
  const avatar = user.avatar
  if (avatar !== null && typeof avatar !== "string") {
    throw new TypeError("Publishing identity avatar is invalid")
  }
  return {
    sync: { enabled: sync.enabled, lastRun },
    storage,
    publishingIdentity: {
      signedIn: true,
      user: {
        id: integer(user.id, "Publishing identity user id"),
        email: text(user.email, "Publishing identity email", 512),
        name: text(user.name, "Publishing identity name", 512),
        avatar: avatar === null ? null : text(avatar, "Publishing identity avatar", 4096),
      },
    },
  }
}

export function decodeDataSettings(value: unknown): DataSettingsDocument {
  const candidate = record(value, "Local data settings")
  const archive = record(candidate.archive, "Workspace archive settings")
  const secureStore = record(candidate.secureStore, "Secure store settings")
  const database = record(candidate.database, "Local database settings")
  const storage = record(candidate.storage, "Persistent storage settings")
  const backend = secureStore.backend
  if (
    backend !== "system-keychain" &&
    backend !== "web-localStorage" &&
    backend !== "unavailable"
  ) {
    throw new TypeError("Secure store backend is invalid")
  }
  if (typeof secureStore.native !== "boolean") {
    throw new TypeError("Secure store native state is invalid")
  }
  if (archive.includesSecrets !== false || archive.importMode !== "replace") {
    throw new TypeError("Workspace archive policy is invalid")
  }
  const error = secureStore.error
  if (error !== null && typeof error !== "string") {
    throw new TypeError("Secure store error is invalid")
  }
  if (database.status !== "healthy" && database.status !== "unavailable") {
    throw new TypeError("Local database health is invalid")
  }
  const databaseError = database.error
  if (databaseError !== null && typeof databaseError !== "string") {
    throw new TypeError("Local database error is invalid")
  }
  const counts =
    database.counts === null
      ? null
      : (() => {
          const item = record(database.counts, "Local database counts")
          return {
            nodes: integer(item.nodes, "Local database node count"),
            blobs: integer(item.blobs, "Local database blob count"),
            trashSnapshots: integer(item.trashSnapshots, "Local database trash count"),
            agentTasks: integer(item.agentTasks, "Local database agent task count"),
          }
        })()
  if (typeof storage.persistenceAvailable !== "boolean") {
    throw new TypeError("Persistent storage availability is invalid")
  }
  if (storage.persisted !== null && typeof storage.persisted !== "boolean") {
    throw new TypeError("Persistent storage state is invalid")
  }
  return {
    archive: {
      kind: text(archive.kind, "Workspace archive kind", 256),
      version: integer(archive.version, "Workspace archive version"),
      includesSecrets: false,
      importMode: "replace",
    },
    secureStore: {
      backend,
      native: secureStore.native,
      fallbackValueCount: integer(secureStore.fallbackValueCount, "Secure store fallback count"),
      legacyValueCount: integer(secureStore.legacyValueCount, "Secure store legacy count"),
      error: error === null ? null : text(error, "Secure store error", 1024),
    },
    database: {
      name: text(database.name, "Local database name", 256),
      version: integer(database.version, "Local database version"),
      status: database.status,
      counts,
      error: databaseError === null ? null : text(databaseError, "Local database error", 1024),
    },
    storage: {
      persistenceAvailable: storage.persistenceAvailable,
      persisted: storage.persisted,
    },
  }
}

function decodeArchiveCounts(value: unknown): SettingsDataArchiveCounts {
  const candidate = record(value, "Workspace archive counts")
  return {
    nodeCount: integer(candidate.nodeCount, "Workspace archive node count"),
    blobCount: integer(candidate.blobCount, "Workspace archive blob count"),
    trashSnapshotCount: integer(
      candidate.trashSnapshotCount,
      "Workspace archive trash snapshot count",
    ),
    pluginCount: integer(candidate.pluginCount, "Workspace archive plugin count"),
    tabCount: integer(candidate.tabCount, "Workspace archive tab count"),
  }
}

export function decodeSettingsDataExportResult(value: unknown): SettingsDataExportResult {
  const candidate = record(value, "Workspace archive export result")
  if (typeof candidate.encrypted !== "boolean") {
    throw new TypeError("Workspace archive encryption state is invalid")
  }
  return {
    filename: text(candidate.filename, "Workspace archive filename", 512),
    content: text(candidate.content, "Workspace archive content", Number.MAX_SAFE_INTEGER),
    encrypted: candidate.encrypted,
  }
}

export function decodeSettingsDataImportPreview(value: unknown): SettingsDataImportPreview {
  const candidate = record(value, "Workspace archive import preview")
  if (
    typeof candidate.ok !== "boolean" ||
    typeof candidate.encrypted !== "boolean" ||
    typeof candidate.requiresPassphrase !== "boolean"
  ) {
    throw new TypeError("Workspace archive preview state is invalid")
  }
  const filename = candidate.filename
  const error = candidate.error
  const packageValue = candidate.package
  return {
    ok: candidate.ok,
    encrypted: candidate.encrypted,
    requiresPassphrase: candidate.requiresPassphrase,
    filename: filename === null ? null : text(filename, "Workspace archive preview filename", 512),
    error: error === null ? null : text(error, "Workspace archive preview error", 1024),
    package:
      packageValue === null
        ? null
        : (() => {
            const item = record(packageValue, "Workspace archive package summary")
            return {
              kind: text(item.kind, "Workspace archive package kind", 256),
              version: integer(item.version, "Workspace archive package version"),
              exportedAt: text(item.exportedAt, "Workspace archive exported time", 128),
            }
          })(),
    archive: candidate.archive === null ? null : decodeArchiveCounts(candidate.archive),
  }
}

export function decodeSettingsDataImportResult(value: unknown): SettingsDataImportResult {
  const candidate = record(value, "Workspace archive import result")
  const imported = record(candidate.imported, "Workspace archive imported counts")
  if (typeof candidate.changed !== "boolean" || typeof candidate.reloadRequired !== "boolean") {
    throw new TypeError("Workspace archive import result is invalid")
  }
  return {
    changed: candidate.changed,
    reloadRequired: candidate.reloadRequired,
    imported: {
      nodes: integer(imported.nodes, "Imported node count"),
      blobs: integer(imported.blobs, "Imported blob count"),
      trash: integer(imported.trash, "Imported trash count"),
      plugins: integer(imported.plugins, "Imported plugin count"),
    },
  }
}

export function decodeSettingsDataPersistenceResult(value: unknown): SettingsDataPersistenceResult {
  const candidate = record(value, "Persistent storage result")
  if (typeof candidate.available !== "boolean" || typeof candidate.granted !== "boolean") {
    throw new TypeError("Persistent storage result is invalid")
  }
  return { available: candidate.available, granted: candidate.granted }
}

export function decodeSettingsDataSecureStoreSelfTestResult(
  value: unknown,
): SettingsDataSecureStoreSelfTestResult {
  const candidate = record(value, "Secure store self-test result")
  if (
    candidate.backend !== "system-keychain" ||
    candidate.roundTrip !== true ||
    candidate.cleanedUp !== true
  ) {
    throw new TypeError("Secure store self-test result is invalid")
  }
  return { backend: "system-keychain", roundTrip: true, cleanedUp: true }
}

export function decodeSettingsDataSecureStoreMigrationResult(
  value: unknown,
): SettingsDataSecureStoreMigrationResult {
  const candidate = record(value, "Secure store migration result")
  if (typeof candidate.available !== "boolean") {
    throw new TypeError("Secure store migration availability is invalid")
  }
  return {
    available: candidate.available,
    migrated: integer(candidate.migrated, "Secure store migrated count"),
    removedPlaintext: integer(candidate.removedPlaintext, "Secure store removed plaintext count"),
    failed: integer(candidate.failed, "Secure store migration failure count"),
    remaining: integer(candidate.remaining, "Secure store remaining plaintext count"),
  }
}

export function decodeConnectionSettings(value: unknown): readonly SettingsConnectionDocument[] {
  if (!Array.isArray(value) || value.length > 4096) {
    throw new TypeError("Connected applications must be an array")
  }
  return value.map((item) => {
    const candidate = record(item, "Connected application")
    return {
      id: text(candidate.id, "Connected application id", 512),
      appId: text(candidate.appId, "Connected application app id", 512),
      name: text(candidate.name, "Connected application name", 512),
      origin: text(candidate.origin, "Connected application origin", 4096),
      permissions: textArray(candidate.permissions, "Connected application permissions"),
      grantedAt: finiteNumber(candidate.grantedAt, "Connected application grant time"),
    }
  })
}

const RUNTIME_EXTENSION_HEALTH = new Set<RuntimeExtensionSettingsHealth>([
  "discovered",
  "verifying",
  "verified",
  "consent-required",
  "ready",
  "activating",
  "active",
  "tearing-down",
  "degraded",
  "quarantined",
  "revoked",
  "unavailable",
])

function isRuntimeExtensionSettingsHealth(value: unknown): value is RuntimeExtensionSettingsHealth {
  return (
    typeof value === "string" &&
    RUNTIME_EXTENSION_HEALTH.has(value as RuntimeExtensionSettingsHealth)
  )
}

export function decodeRuntimeExtensionSettings(
  value: unknown,
): readonly RuntimeExtensionSettingsDocument[] {
  if (!Array.isArray(value) || value.length > 4096) {
    throw new TypeError("Runtime extensions must be an array")
  }
  return value.map((item) => {
    const candidate = record(item, "Runtime extension")
    const sourceValue = candidate.source
    const source =
      sourceValue === null
        ? null
        : (() => {
            const inner = record(sourceValue, "Runtime extension source")
            if (inner.kind !== "builtin" && inner.kind !== "package") {
              throw new TypeError("Runtime extension source kind is invalid")
            }
            const kind: "builtin" | "package" = inner.kind
            return { kind, id: text(inner.id, "Runtime extension source id", 512) }
          })()
    const health = candidate.health
    if (!isRuntimeExtensionSettingsHealth(health)) {
      throw new TypeError("Runtime extension health is invalid")
    }
    const failure = candidate.failure
    if (failure !== null && typeof failure !== "string") {
      throw new TypeError("Runtime extension failure is invalid")
    }
    if (typeof candidate.desired !== "boolean") {
      throw new TypeError("Runtime extension desired state is invalid")
    }
    return {
      id: text(candidate.id, "Runtime extension id", 512),
      label: text(candidate.label, "Runtime extension label", 512),
      version: integer(candidate.version, "Runtime extension version"),
      source,
      permissions: textArray(candidate.permissions, "Runtime extension permissions"),
      digest: text(candidate.digest, "Runtime extension digest", 4096),
      permissionDigest: text(
        candidate.permissionDigest,
        "Runtime extension permission digest",
        4096,
      ),
      desired: candidate.desired,
      health,
      failure,
      pendingCleanup: textArray(candidate.pendingCleanup, "Runtime extension pending cleanup"),
    }
  })
}

export function decodeSettingsMutationResult(value: unknown): SettingsMutationResult {
  const candidate = record(value, "Settings action result")
  if (typeof candidate.changed !== "boolean") {
    throw new TypeError("Settings action result is invalid")
  }
  return { changed: candidate.changed }
}
