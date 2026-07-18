import type { FileRef } from "@protocol/file-system"
import { fileRefKey } from "@protocol/file-system"
import {
  enginePreferencesStorageKey,
  type EnginePreferenceScope,
  type EnginePreferences,
} from "@/engines/preferences"

/**
 * `app.display` 的 engines.json 契约（docs/freedesktop-alignment.md §4）：
 * Engine 关联（mimeapps.list 形状）的 config 类投影文件。localStorage 仍是物理真相，
 * 文件只是同一 store 的 CAS 投影（settings appearance 同模式）。
 */

export const DISPLAY_ENGINES_FILE_NAME = "engines.json"
export const DISPLAY_ENGINES_MEDIA_TYPE = "application/json"

/**
 * Engine 关联写权限。**有意不进 `@/plugins/embed/protocol` 的 PERMISSIONS**——
 * 与 `agent.config:write` 同先例：配置写默认不授给 agent/embed，任何 grant 都拿不到
 * 这个位；引擎关联决定文件由哪个 renderer 解释，不应成为普通 fs:write 的旁路面。
 */
export const DISPLAY_ENGINES_WRITE_PERMISSION = "display.engines:write"

export const DISPLAY_ENGINES_SET_FILE_DEFAULT_ACTION = "preferences.setFileDefault"
export const DISPLAY_ENGINES_SET_MEDIA_TYPE_DEFAULT_ACTION = "preferences.setMediaTypeDefault"
export const DISPLAY_ENGINES_REMOVE_ASSOCIATION_ACTION = "preferences.removeAssociation"
export const DISPLAY_ENGINES_RESTORE_ASSOCIATION_ACTION = "preferences.restoreAssociation"

export const DISPLAY_ENGINES_SCOPES: readonly EnginePreferenceScope[] = [
  "files",
  "audio",
  "development",
]

/** provider 跨窗口 watch 监听的全部偏好键（含 files 的裸键）。 */
export const DISPLAY_ENGINES_STORAGE_KEYS: ReadonlySet<string> = new Set(
  DISPLAY_ENGINES_SCOPES.map((scope) => enginePreferencesStorageKey(scope)),
)

/** engines.json 的文档形状（v2：每个 scope 含默认关联与 Removed Associations）。 */
export type DisplayEnginesScopeDocument = Readonly<{
  files: Readonly<Record<string, string>>
  mediaTypes: Readonly<Record<string, string>>
  removed: Readonly<Record<string, readonly string[]>>
}>

export type DisplayEnginesDocument = Readonly<{
  version: 2
  scopes: Readonly<Record<EnginePreferenceScope, DisplayEnginesScopeDocument>>
}>

export function scopeDocument(preferences: EnginePreferences): DisplayEnginesScopeDocument {
  return Object.freeze({
    files: preferences.files,
    mediaTypes: preferences.mediaTypes,
    removed: preferences.removed,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isEngineIdMap(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (engineId) =>
        typeof engineId === "string" && engineId.length > 0 && engineId === engineId.trim(),
    )
  )
}

function isRemovedMap(value: unknown): value is Record<string, readonly string[]> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (engineIds) =>
        Array.isArray(engineIds) &&
        engineIds.every(
          (engineId) =>
            typeof engineId === "string" && engineId.length > 0 && engineId === engineId.trim(),
        ),
    )
  )
}

/** 严格校验完整文档（三个 scope 必须齐备且形状合法）；不合法返回 null，由调用方映射 invalid-input。 */
export function decodeDisplayEnginesDocument(value: unknown): DisplayEnginesDocument | null {
  if (!isRecord(value) || value.version !== 2 || !isRecord(value.scopes)) return null
  const scopes: Record<string, DisplayEnginesScopeDocument> = {}
  for (const scope of DISPLAY_ENGINES_SCOPES) {
    const section = value.scopes[scope]
    if (
      !isRecord(section) ||
      !isEngineIdMap(section.files) ||
      !isEngineIdMap(section.mediaTypes) ||
      !isRemovedMap(section.removed)
    ) {
      return null
    }
    scopes[scope] = Object.freeze({
      files: section.files,
      mediaTypes: section.mediaTypes,
      removed: section.removed,
    })
  }
  return Object.freeze({
    version: 2,
    scopes: Object.freeze(scopes as Record<EnginePreferenceScope, DisplayEnginesScopeDocument>),
  })
}

export type DisplayEnginesActionInput =
  | Readonly<{ scope: EnginePreferenceScope; fileRef: string; engineId: string | null }>
  | Readonly<{ scope: EnginePreferenceScope; mediaType: string; engineId: string | null }>

function isScope(value: unknown): value is EnginePreferenceScope {
  return value === "files" || value === "audio" || value === "development"
}

function isEngineIdOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0 && value === value.trim())
}

/** preferences.setFileDefault 输入：{ scope, fileRef(fileRefKey), engineId|null }。 */
export function decodeSetFileDefaultInput(
  value: unknown,
): { scope: EnginePreferenceScope; ref: FileRef; engineId: string | null } | null {
  if (!isRecord(value) || !isScope(value.scope) || typeof value.fileRef !== "string") return null
  if (!isEngineIdOrNull(value.engineId)) return null
  const separator = value.fileRef.indexOf(":")
  if (separator <= 0 || separator === value.fileRef.length - 1) return null
  return {
    scope: value.scope,
    ref: {
      fileSystemId: decodeURIComponent(value.fileRef.slice(0, separator)),
      fileId: decodeURIComponent(value.fileRef.slice(separator + 1)),
    },
    engineId: value.engineId,
  }
}

/** preferences.setMediaTypeDefault / removeAssociation / restoreAssociation 输入。 */
export function decodeMediaTypeActionInput(value: unknown): {
  scope: EnginePreferenceScope
  mediaType: string
  engineId: string | null
} | null {
  if (
    !isRecord(value) ||
    !isScope(value.scope) ||
    typeof value.mediaType !== "string" ||
    value.mediaType.trim() !== value.mediaType ||
    value.mediaType.length === 0
  ) {
    return null
  }
  if (!isEngineIdOrNull(value.engineId)) return null
  return { scope: value.scope, mediaType: value.mediaType, engineId: value.engineId }
}

export function encodeFileDefaultInput(
  scope: EnginePreferenceScope,
  ref: FileRef,
  engineId: string | null,
): DisplayEnginesActionInput {
  return { scope, fileRef: fileRefKey(ref), engineId }
}
