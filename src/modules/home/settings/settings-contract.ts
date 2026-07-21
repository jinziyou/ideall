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
export const SETTINGS_RUNTIME_AUTHORIZE_ACTION = "authorize-extension"
export const SETTINGS_RUNTIME_RETRY_ACTION = "retry-extension"
export const SETTINGS_RUNTIME_REVOKE_ACTION = "revoke-extension"
export const SETTINGS_RUNTIME_UNINSTALL_ACTION = "uninstall-extension"
export const SETTINGS_RUNTIME_INSTALL_PACKAGE_ACTION = "install-extension-package"
export const SETTINGS_RUNTIME_ROLLBACK_PACKAGE_ACTION = "rollback-extension-package"
export const SETTINGS_RUNTIME_INSPECT_PUBLISHER_ACTION = "inspect-extension-publisher"
export const SETTINGS_RUNTIME_TRUST_PUBLISHER_ACTION = "trust-extension-publisher"
export const SETTINGS_RUNTIME_REVOKE_PUBLISHER_ACTION = "revoke-extension-publisher"
export const SETTINGS_RUNTIME_INSPECT_PUBLISHER_ROTATION_ACTION =
  "inspect-extension-publisher-rotation"
export const SETTINGS_RUNTIME_APPLY_PUBLISHER_ROTATION_ACTION = "apply-extension-publisher-rotation"
export const SETTINGS_RUNTIME_IMPORT_REVOCATIONS_ACTION = "import-extension-revocations"
export const SETTINGS_RUNTIME_REFRESH_REGISTRY_ACTION = "refresh-extension-registry"
export const SETTINGS_RUNTIME_PREPARE_UPDATE_ACTION = "prepare-extension-update"
export const SETTINGS_RUNTIME_APPLY_UPDATE_ACTION = "apply-extension-update"
export const SETTINGS_RUNTIME_DISCARD_UPDATE_ACTION = "discard-extension-update"

export const SETTINGS_RUNTIME_ACTIONS = [
  SETTINGS_RUNTIME_AUTHORIZE_ACTION,
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
          id: string
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
      agentWriteAudits: number
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
  | "revocation-failed"
  | "revoked"
  | "rejected"
  | "unavailable"

export type RuntimeExtensionSettingsDocument = Readonly<{
  id: string
  label: string
  version: number
  source: Readonly<{ kind: "builtin" | "package"; id: string }> | null
  publisherFingerprint: string | null
  permissions: readonly string[]
  digest: string
  permissionDigest: string
  verification: Readonly<{ verifierId: string; verifiedAt: number }> | null
  grantedAt: number | null
  desired: boolean
  health: RuntimeExtensionSettingsHealth
  failure: string | null
  pendingCleanup: readonly string[]
  rollbackVersion: number | null
}>

export type RuntimeExtensionPublisherSettingsDocument = Readonly<{
  publisher: string
  label: string
  fingerprint: string
  status: "official" | "trusted" | "revoked"
  trustedAt: number | null
  revokedAt: number | null
  revocationSequence: number | null
  revocationIssuedAt: number | null
  revokedDigestCount: number
  keySequence: number
  rotatedAt: number | null
  retiredKeyCount: number
}>

export type RuntimeExtensionRegistryEntry = Readonly<{
  id: string
  label: string
  summary: string
  version: number
  publisher: string
  publisherFingerprint: string
  permissions: readonly ("resources:read" | "tools:invoke")[]
  digest: string
  packageUrl: string
  packageSha256: string
  publishedAt: number
}>

export type RuntimeExtensionRegistrySettings = Readonly<{
  status: "unavailable" | "current" | "stale"
  source: "network" | "cache" | null
  fetchedAt: number | null
  generatedAt: number | null
  expiresAt: number | null
  sequence: number | null
  failureCode: string | null
  entries: readonly RuntimeExtensionRegistryEntry[]
}>

export type RuntimeExtensionSettings = Readonly<{
  nativeAvailable: boolean
  extensions: readonly RuntimeExtensionSettingsDocument[]
  publishers: readonly RuntimeExtensionPublisherSettingsDocument[]
  registry: RuntimeExtensionRegistrySettings
}>

export type RuntimeExtensionPublisherCandidate = Readonly<{
  publisher: string
  label: string
  publicKey: string
  fingerprint: string
}>

export type RuntimeExtensionPublisherRotationCandidate = Readonly<{
  publisher: string
  label: string
  sequence: number
  issuedAt: number
  currentFingerprint: string
  nextFingerprint: string
  payload: string
  currentSignature: string
  nextSignature: string
}>

export type RuntimeExtensionUpdateCandidate = Readonly<{
  token: string
  registrySequence: number
  registryExpiresAt: number
  id: string
  label: string
  currentVersion: number
  nextVersion: number
  publisher: string
  publisherFingerprint: string
  currentPermissions: readonly ("resources:read" | "tools:invoke")[]
  nextPermissions: readonly ("resources:read" | "tools:invoke")[]
  addedPermissions: readonly ("resources:read" | "tools:invoke")[]
  removedPermissions: readonly ("resources:read" | "tools:invoke")[]
  digest: string
  packageSha256: string
  publishedAt: number
}>

export type SettingsMutationResult = Readonly<{ changed: boolean }>

export type SettingsDocumentBySection = Readonly<{
  appearance: AppearanceSettingsDocument
  device: DeviceSettingsDocument
  data: DataSettingsDocument
  connections: readonly SettingsConnectionDocument[]
  "runtime-extensions": RuntimeExtensionSettings
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
        id: text(user.id, "Publishing identity user id", 128),
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
            agentWriteAudits: integer(
              item.agentWriteAudits,
              "Local database Agent write audit count",
            ),
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
  "revocation-failed",
  "revoked",
  "rejected",
  "unavailable",
])

function isRuntimeExtensionSettingsHealth(value: unknown): value is RuntimeExtensionSettingsHealth {
  return (
    typeof value === "string" &&
    RUNTIME_EXTENSION_HEALTH.has(value as RuntimeExtensionSettingsHealth)
  )
}

export function decodeRuntimeExtensionSettings(value: unknown): RuntimeExtensionSettings {
  const document = record(value, "Runtime extension settings")
  if (typeof document.nativeAvailable !== "boolean") {
    throw new TypeError("Runtime extension native availability is invalid")
  }
  if (!Array.isArray(document.extensions) || document.extensions.length > 4096) {
    throw new TypeError("Runtime extensions must be an array")
  }
  const extensions = document.extensions.map((item) => {
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
    const verificationValue = candidate.verification
    const verification =
      verificationValue === null
        ? null
        : (() => {
            const inner = record(verificationValue, "Runtime extension verification")
            return {
              verifierId: text(inner.verifierId, "Runtime extension verifier id", 512),
              verifiedAt: integer(inner.verifiedAt, "Runtime extension verification time"),
            }
          })()
    const grantedAt =
      candidate.grantedAt === null
        ? null
        : integer(candidate.grantedAt, "Runtime extension grant time")
    const publisherFingerprint =
      candidate.publisherFingerprint === null
        ? null
        : text(candidate.publisherFingerprint, "Runtime extension publisher fingerprint", 128)
    const rollbackVersion =
      candidate.rollbackVersion === null
        ? null
        : integer(candidate.rollbackVersion, "Runtime extension rollback version")
    return {
      id: text(candidate.id, "Runtime extension id", 512),
      label: text(candidate.label, "Runtime extension label", 512),
      version: integer(candidate.version, "Runtime extension version"),
      source,
      publisherFingerprint,
      permissions: textArray(candidate.permissions, "Runtime extension permissions"),
      digest: text(candidate.digest, "Runtime extension digest", 4096),
      permissionDigest: text(
        candidate.permissionDigest,
        "Runtime extension permission digest",
        4096,
      ),
      verification,
      grantedAt,
      desired: candidate.desired,
      health,
      failure,
      pendingCleanup: textArray(candidate.pendingCleanup, "Runtime extension pending cleanup"),
      rollbackVersion,
    }
  })
  if (!Array.isArray(document.publishers) || document.publishers.length > 65) {
    throw new TypeError("Runtime extension publishers must be an array")
  }
  const publishers = document.publishers.map((item) => {
    const candidate = record(item, "Runtime extension publisher")
    if (
      candidate.status !== "official" &&
      candidate.status !== "trusted" &&
      candidate.status !== "revoked"
    ) {
      throw new TypeError("Runtime extension publisher status is invalid")
    }
    const nullableTime = (value: unknown, label: string) =>
      value === null ? null : integer(value, label)
    const keySequence = integer(candidate.keySequence, "Runtime extension publisher key sequence")
    const retiredKeyCount = integer(
      candidate.retiredKeyCount,
      "Runtime extension publisher retired key count",
    )
    const rotatedAt = nullableTime(candidate.rotatedAt, "Runtime extension publisher rotation time")
    if (
      keySequence < 1 ||
      retiredKeyCount > 32 ||
      retiredKeyCount + 1 !== keySequence ||
      (keySequence === 1 ? rotatedAt !== null : rotatedAt === null)
    ) {
      throw new TypeError("Runtime extension publisher key history is invalid")
    }
    return {
      publisher: text(candidate.publisher, "Runtime extension publisher id", 128),
      label: text(candidate.label, "Runtime extension publisher label", 160),
      fingerprint: text(candidate.fingerprint, "Runtime extension publisher fingerprint", 128),
      status: candidate.status,
      trustedAt: nullableTime(candidate.trustedAt, "Runtime extension publisher trust time"),
      revokedAt: nullableTime(candidate.revokedAt, "Runtime extension publisher revoke time"),
      revocationSequence: nullableTime(
        candidate.revocationSequence,
        "Runtime extension revocation sequence",
      ),
      revocationIssuedAt: nullableTime(
        candidate.revocationIssuedAt,
        "Runtime extension revocation issue time",
      ),
      revokedDigestCount: integer(
        candidate.revokedDigestCount,
        "Runtime extension revoked digest count",
      ),
      keySequence,
      rotatedAt,
      retiredKeyCount,
    } satisfies RuntimeExtensionPublisherSettingsDocument
  })
  const registryValue = record(document.registry, "Runtime extension registry")
  if (
    registryValue.status !== "unavailable" &&
    registryValue.status !== "current" &&
    registryValue.status !== "stale"
  ) {
    throw new TypeError("Runtime extension registry status is invalid")
  }
  if (
    registryValue.source !== null &&
    registryValue.source !== "network" &&
    registryValue.source !== "cache"
  ) {
    throw new TypeError("Runtime extension registry source is invalid")
  }
  if (!Array.isArray(registryValue.entries) || registryValue.entries.length > 256) {
    throw new TypeError("Runtime extension registry entries must be bounded")
  }
  const registryEntries = registryValue.entries.map((item) => {
    const entry = record(item, "Runtime extension registry entry")
    if (!Array.isArray(entry.permissions) || entry.permissions.length > 2) {
      throw new TypeError("Runtime extension registry permissions must be bounded")
    }
    const permissions = entry.permissions.map((permission) => {
      if (permission !== "resources:read" && permission !== "tools:invoke") {
        throw new TypeError("Runtime extension registry permission is invalid")
      }
      return permission
    })
    if (
      permissions.length === 0 ||
      new Set(permissions).size !== permissions.length ||
      !permissions.slice(1).every((permission, index) => permissions[index] < permission)
    ) {
      throw new TypeError("Runtime extension registry permissions are invalid")
    }
    const packageUrl = text(entry.packageUrl, "Runtime extension registry package URL", 4096)
    let parsedUrl: URL
    try {
      parsedUrl = new URL(packageUrl)
    } catch {
      throw new TypeError("Runtime extension registry package URL is invalid")
    }
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.username !== "" ||
      parsedUrl.password !== "" ||
      parsedUrl.port !== "" ||
      parsedUrl.search !== "" ||
      parsedUrl.hash !== ""
    ) {
      throw new TypeError("Runtime extension registry package URL is unsafe")
    }
    const packageSha256 = text(entry.packageSha256, "Runtime extension package SHA-256", 64)
    if (!/^[a-f0-9]{64}$/.test(packageSha256)) {
      throw new TypeError("Runtime extension package SHA-256 is invalid")
    }
    return {
      id: text(entry.id, "Runtime extension registry id", 128),
      label: text(entry.label, "Runtime extension registry label", 160),
      summary: text(entry.summary, "Runtime extension registry summary", 512),
      version: integer(entry.version, "Runtime extension registry version"),
      publisher: text(entry.publisher, "Runtime extension registry publisher", 128),
      publisherFingerprint: text(
        entry.publisherFingerprint,
        "Runtime extension registry publisher fingerprint",
        128,
      ),
      permissions,
      digest: text(entry.digest, "Runtime extension registry digest", 128),
      packageUrl,
      packageSha256,
      publishedAt: integer(entry.publishedAt, "Runtime extension registry publish time"),
    } satisfies RuntimeExtensionRegistryEntry
  })
  if (!registryEntries.slice(1).every((entry, index) => registryEntries[index].id < entry.id)) {
    throw new TypeError("Runtime extension registry entries must be uniquely ordered")
  }
  const nullableRegistryInteger = (value: unknown, label: string) =>
    value === null ? null : integer(value, label)
  const registry = {
    status: registryValue.status,
    source: registryValue.source,
    fetchedAt: nullableRegistryInteger(
      registryValue.fetchedAt,
      "Runtime extension registry fetch time",
    ),
    generatedAt: nullableRegistryInteger(
      registryValue.generatedAt,
      "Runtime extension registry generation time",
    ),
    expiresAt: nullableRegistryInteger(
      registryValue.expiresAt,
      "Runtime extension registry expiry time",
    ),
    sequence: nullableRegistryInteger(
      registryValue.sequence,
      "Runtime extension registry sequence",
    ),
    failureCode:
      registryValue.failureCode === null
        ? null
        : text(registryValue.failureCode, "Runtime extension registry failure code", 128),
    entries: registryEntries,
  } satisfies RuntimeExtensionRegistrySettings
  const hasSnapshot = registry.status !== "unavailable"
  if (
    (hasSnapshot &&
      (registry.source === null ||
        registry.fetchedAt === null ||
        registry.generatedAt === null ||
        registry.expiresAt === null ||
        registry.sequence === null)) ||
    (!hasSnapshot &&
      (registry.source !== null ||
        registry.fetchedAt !== null ||
        registry.generatedAt !== null ||
        registry.expiresAt !== null ||
        registry.sequence !== null ||
        registry.entries.length > 0))
  ) {
    throw new TypeError("Runtime extension registry snapshot state is inconsistent")
  }
  return { nativeAvailable: document.nativeAvailable, extensions, publishers, registry }
}

export function decodeRuntimeExtensionPublisherCandidate(
  value: unknown,
): RuntimeExtensionPublisherCandidate | null {
  if (value === null) return null
  const candidate = record(value, "Runtime extension publisher candidate")
  return {
    publisher: text(candidate.publisher, "Runtime extension publisher id", 128),
    label: text(candidate.label, "Runtime extension publisher label", 160),
    publicKey: text(candidate.publicKey, "Runtime extension publisher public key", 256),
    fingerprint: text(candidate.fingerprint, "Runtime extension publisher fingerprint", 128),
  }
}

function signedPublisherDocumentPart(value: unknown, label: string, max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    value.includes("\u0000")
  ) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

export function decodeRuntimeExtensionPublisherRotationCandidate(
  value: unknown,
): RuntimeExtensionPublisherRotationCandidate | null {
  if (value === null) return null
  const candidate = record(value, "Runtime extension publisher rotation candidate")
  const publisher = text(candidate.publisher, "Runtime extension publisher rotation id", 128)
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(publisher)) {
    throw new TypeError("Runtime extension publisher rotation id is invalid")
  }
  const currentFingerprint = text(
    candidate.currentFingerprint,
    "Runtime extension publisher current fingerprint",
    128,
  )
  const nextFingerprint = text(
    candidate.nextFingerprint,
    "Runtime extension publisher next fingerprint",
    128,
  )
  if (
    !/^sha256:[A-Za-z0-9_-]{43}$/.test(currentFingerprint) ||
    !/^sha256:[A-Za-z0-9_-]{43}$/.test(nextFingerprint) ||
    currentFingerprint === nextFingerprint
  ) {
    throw new TypeError("Runtime extension publisher rotation fingerprints are invalid")
  }
  const sequence = integer(candidate.sequence, "Runtime extension publisher rotation sequence")
  const issuedAt = integer(candidate.issuedAt, "Runtime extension publisher rotation issue time")
  if (sequence < 1 || issuedAt < 1) {
    throw new TypeError("Runtime extension publisher rotation metadata is invalid")
  }
  return {
    publisher,
    label: text(candidate.label, "Runtime extension publisher rotation label", 160),
    sequence,
    issuedAt,
    currentFingerprint,
    nextFingerprint,
    payload: signedPublisherDocumentPart(
      candidate.payload,
      "Publisher rotation payload",
      32 * 1024,
    ),
    currentSignature: signedPublisherDocumentPart(
      candidate.currentSignature,
      "Publisher rotation current signature",
      8 * 1024,
    ),
    nextSignature: signedPublisherDocumentPart(
      candidate.nextSignature,
      "Publisher rotation next signature",
      8 * 1024,
    ),
  }
}

function decodeUpdatePermissions(
  value: unknown,
  label: string,
): ("resources:read" | "tools:invoke")[] {
  if (!Array.isArray(value) || value.length > 2) throw new TypeError(`${label} is invalid`)
  const permissions = value.map((permission) => {
    if (permission !== "resources:read" && permission !== "tools:invoke") {
      throw new TypeError(`${label} is invalid`)
    }
    return permission
  })
  if (
    new Set(permissions).size !== permissions.length ||
    !permissions.slice(1).every((permission, index) => permissions[index] < permission)
  ) {
    throw new TypeError(`${label} is invalid`)
  }
  return permissions
}

export function decodeRuntimeExtensionUpdateCandidate(
  value: unknown,
): RuntimeExtensionUpdateCandidate {
  const candidate = record(value, "Runtime extension update candidate")
  const token = text(candidate.token, "Runtime extension update token", 36)
  const id = text(candidate.id, "Runtime extension update id", 128)
  const publisher = text(candidate.publisher, "Runtime extension update publisher", 128)
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token) ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(id) ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(publisher)
  ) {
    throw new TypeError("Runtime extension update identity is invalid")
  }
  const currentPermissions = decodeUpdatePermissions(
    candidate.currentPermissions,
    "Runtime extension current permissions",
  )
  const nextPermissions = decodeUpdatePermissions(
    candidate.nextPermissions,
    "Runtime extension next permissions",
  )
  const addedPermissions = decodeUpdatePermissions(
    candidate.addedPermissions,
    "Runtime extension added permissions",
  )
  const removedPermissions = decodeUpdatePermissions(
    candidate.removedPermissions,
    "Runtime extension removed permissions",
  )
  const expectedAdded = nextPermissions.filter(
    (permission) => !currentPermissions.includes(permission),
  )
  const expectedRemoved = currentPermissions.filter(
    (permission) => !nextPermissions.includes(permission),
  )
  const currentVersion = integer(candidate.currentVersion, "Runtime extension current version")
  const nextVersion = integer(candidate.nextVersion, "Runtime extension next version")
  const registrySequence = integer(
    candidate.registrySequence,
    "Runtime extension registry sequence",
  )
  const registryExpiresAt = integer(
    candidate.registryExpiresAt,
    "Runtime extension registry expiry time",
  )
  const publishedAt = integer(candidate.publishedAt, "Runtime extension publish time")
  const publisherFingerprint = text(
    candidate.publisherFingerprint,
    "Runtime extension publisher fingerprint",
    128,
  )
  const digest = text(candidate.digest, "Runtime extension update digest", 128)
  const packageSha256 = text(candidate.packageSha256, "Runtime extension package SHA-256", 64)
  if (
    currentPermissions.length === 0 ||
    nextPermissions.length === 0 ||
    currentVersion < 1 ||
    nextVersion <= currentVersion ||
    registrySequence < 1 ||
    registryExpiresAt < 1 ||
    publishedAt < 1 ||
    publishedAt >= registryExpiresAt ||
    addedPermissions.join("\u0000") !== expectedAdded.join("\u0000") ||
    removedPermissions.join("\u0000") !== expectedRemoved.join("\u0000") ||
    !/^sha256:[A-Za-z0-9_-]{43}$/.test(publisherFingerprint) ||
    !/^sha256:[A-Za-z0-9_-]{43}$/.test(digest) ||
    !/^[a-f0-9]{64}$/.test(packageSha256)
  ) {
    throw new TypeError("Runtime extension update candidate is invalid")
  }
  return {
    token,
    registrySequence,
    registryExpiresAt,
    id,
    label: text(candidate.label, "Runtime extension update label", 160),
    currentVersion,
    nextVersion,
    publisher,
    publisherFingerprint,
    currentPermissions,
    nextPermissions,
    addedPermissions,
    removedPermissions,
    digest,
    packageSha256,
    publishedAt,
  }
}

export function decodeSettingsMutationResult(value: unknown): SettingsMutationResult {
  const candidate = record(value, "Settings action result")
  if (typeof candidate.changed !== "boolean") {
    throw new TypeError("Settings action result is invalid")
  }
  return { changed: candidate.changed }
}
