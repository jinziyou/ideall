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
  "connections",
  "runtime-extensions",
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

export const SETTINGS_CONNECTION_REVOKE_ACTION = "revoke-connection"
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
  sync: Readonly<{ enabled: boolean }>
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
      sync: { enabled: sync.enabled },
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
    sync: { enabled: sync.enabled },
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
