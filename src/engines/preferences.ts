import type { FileRef } from "@protocol/file-system"
import { fileRefKey } from "@protocol/file-system"
import { mediaTypeAncestors } from "./media-type-tree"
import { normalizeMediaType } from "./matcher"

export const ENGINE_PREFERENCES_VERSION = 2 as const
export const ENGINE_PREFERENCES_STORAGE_KEY = "ideall:engine-preferences"
export type EnginePreferenceScope = "files" | "audio" | "development"

export function enginePreferencesStorageKey(scope: EnginePreferenceScope): string {
  return scope === "files"
    ? ENGINE_PREFERENCES_STORAGE_KEY
    : `${ENGINE_PREFERENCES_STORAGE_KEY}:${scope}`
}

export type EnginePreferences = Readonly<{
  version: typeof ENGINE_PREFERENCES_VERSION
  files: Readonly<Record<string, string>>
  mediaTypes: Readonly<Record<string, string>>
  /**
   * Removed Associations（mimeapps.list 语义）：按归一化 mediaType 屏蔽引擎。
   * 解析时沿 subclass 父链生效；屏蔽不得清空候选（registry 侧守卫）。
   */
  removed: Readonly<Record<string, readonly string[]>>
}>

export type EnginePreferenceStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function frozenPreferences(
  files: Record<string, string>,
  mediaTypes: Record<string, string>,
  removed: Record<string, readonly string[]>,
): EnginePreferences {
  return Object.freeze({
    version: ENGINE_PREFERENCES_VERSION,
    files: Object.freeze(files),
    mediaTypes: Object.freeze(mediaTypes),
    removed: Object.freeze(removed),
  })
}

export function emptyEnginePreferences(): EnginePreferences {
  return frozenPreferences({}, {}, {})
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function validEngineId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim()
}

function sanitizePreferenceMap(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  return Object.fromEntries(
    Object.entries(record).filter(([key, engineId]) => key.length > 0 && validEngineId(engineId)),
  ) as Record<string, string>
}

function sanitizeMediaTypeMap(value: unknown): Record<string, string> {
  const entries = Object.entries(sanitizePreferenceMap(value))
    .map(([mediaType, engineId]) => [normalizeMediaType(mediaType), engineId] as const)
    .filter(([mediaType]) => mediaType.length > 0)
  return Object.fromEntries(entries)
}

function sanitizeRemovedMap(value: unknown): Record<string, readonly string[]> {
  const record = asRecord(value)
  if (!record) return {}
  const removed: Record<string, readonly string[]> = {}
  for (const [rawType, rawEngineIds] of Object.entries(record)) {
    const mediaType = normalizeMediaType(rawType)
    if (!mediaType || !Array.isArray(rawEngineIds)) continue
    const engineIds = [...new Set(rawEngineIds.filter(validEngineId))]
    if (engineIds.length > 0) removed[mediaType] = Object.freeze(engineIds)
  }
  return removed
}

export function parseEnginePreferences(raw: string | null | undefined): EnginePreferences {
  if (!raw) return emptyEnginePreferences()
  try {
    const value = asRecord(JSON.parse(raw))
    // v1（无 removed）读取时升级为空屏蔽表；写出一律 v2。
    if (!value || (value.version !== 1 && value.version !== ENGINE_PREFERENCES_VERSION)) {
      return emptyEnginePreferences()
    }
    return frozenPreferences(
      sanitizePreferenceMap(value.files),
      sanitizeMediaTypeMap(value.mediaTypes),
      sanitizeRemovedMap(value.removed),
    )
  } catch {
    return emptyEnginePreferences()
  }
}

export function readEnginePreferences(
  storage: EnginePreferenceStorage | null | undefined,
  storageKey = ENGINE_PREFERENCES_STORAGE_KEY,
): EnginePreferences {
  if (!storage) return emptyEnginePreferences()
  try {
    return parseEnginePreferences(storage.getItem(storageKey))
  } catch {
    return emptyEnginePreferences()
  }
}

export function writeEnginePreferences(
  storage: EnginePreferenceStorage | null | undefined,
  preferences: EnginePreferences,
  storageKey = ENGINE_PREFERENCES_STORAGE_KEY,
): boolean {
  if (!storage) return false
  try {
    storage.setItem(storageKey, JSON.stringify(preferences))
    return true
  } catch {
    return false
  }
}

export function getFileEnginePreference(
  preferences: EnginePreferences,
  ref: FileRef,
): string | null {
  const key = fileRefKey(ref)
  return Object.hasOwn(preferences.files, key) ? preferences.files[key] : null
}

/**
 * 查找 media type 的默认引擎偏好：先精确类型，再沿显式 subclass 父链上溯（近亲优先，
 * 与 shared-mime-info/GIO 的默认应用查找同语义）——为 `text/plain` 设置的默认引擎
 * 对 `text/markdown` 生效，除非 `text/markdown` 另有偏好。
 */
export function getMediaTypeEnginePreference(
  preferences: EnginePreferences,
  mediaType: string,
): string | null {
  const key = normalizeMediaType(mediaType)
  if (!key) return null
  if (Object.hasOwn(preferences.mediaTypes, key)) return preferences.mediaTypes[key]
  for (const ancestor of mediaTypeAncestors(key)) {
    if (Object.hasOwn(preferences.mediaTypes, ancestor)) return preferences.mediaTypes[ancestor]
  }
  return null
}

export function withFileEnginePreference(
  preferences: EnginePreferences,
  ref: FileRef,
  engineId: string | null,
): EnginePreferences {
  if (engineId !== null && !validEngineId(engineId))
    throw new TypeError("engineId must not be empty")
  const files = { ...preferences.files }
  if (engineId === null) delete files[fileRefKey(ref)]
  else files[fileRefKey(ref)] = engineId
  return frozenPreferences(files, { ...preferences.mediaTypes }, { ...preferences.removed })
}

export function withMediaTypeEnginePreference(
  preferences: EnginePreferences,
  mediaType: string,
  engineId: string | null,
): EnginePreferences {
  const normalizedType = normalizeMediaType(mediaType)
  if (!normalizedType) throw new TypeError("mediaType must not be empty")
  if (engineId !== null && !validEngineId(engineId))
    throw new TypeError("engineId must not be empty")
  const mediaTypes = { ...preferences.mediaTypes }
  if (engineId === null) delete mediaTypes[normalizedType]
  else mediaTypes[normalizedType] = engineId
  // 「设为默认」自动解除同类型同引擎的屏蔽（显式默认优先于 Removed Associations）。
  const removed = { ...preferences.removed }
  if (engineId !== null) {
    const current = removed[normalizedType]
    if (current?.includes(engineId)) {
      const next = current.filter((id) => id !== engineId)
      if (next.length > 0) removed[normalizedType] = Object.freeze(next)
      else delete removed[normalizedType]
    }
  }
  return frozenPreferences({ ...preferences.files }, mediaTypes, removed)
}

/** 屏蔽引擎对指定 mediaType 的关联（Removed Associations 新增）。 */
export function withEngineAssociationRemoved(
  preferences: EnginePreferences,
  mediaType: string,
  engineId: string,
): EnginePreferences {
  const normalizedType = normalizeMediaType(mediaType)
  if (!normalizedType) throw new TypeError("mediaType must not be empty")
  if (!validEngineId(engineId)) throw new TypeError("engineId must not be empty")
  const removed = { ...preferences.removed }
  const current = removed[normalizedType] ?? []
  if (!current.includes(engineId)) {
    removed[normalizedType] = Object.freeze([...current, engineId])
  }
  return frozenPreferences({ ...preferences.files }, { ...preferences.mediaTypes }, removed)
}

/** 解除屏蔽；该类型不再有屏蔽项时删除键。 */
export function withEngineAssociationRestored(
  preferences: EnginePreferences,
  mediaType: string,
  engineId: string,
): EnginePreferences {
  const normalizedType = normalizeMediaType(mediaType)
  if (!normalizedType) throw new TypeError("mediaType must not be empty")
  if (!validEngineId(engineId)) throw new TypeError("engineId must not be empty")
  const removed = { ...preferences.removed }
  const current = removed[normalizedType]
  if (current) {
    const next = current.filter((id) => id !== engineId)
    if (next.length > 0) removed[normalizedType] = Object.freeze(next)
    else delete removed[normalizedType]
  }
  return frozenPreferences({ ...preferences.files }, { ...preferences.mediaTypes }, removed)
}

/**
 * 引擎对指定 mediaType 是否被屏蔽：先查精确类型，再沿 subclass 父链上溯
 * （与默认引擎偏好查找同一遍历；近亲级别的屏蔽对子类型同样生效）。
 */
export function isEngineAssociationRemoved(
  preferences: EnginePreferences,
  mediaType: string,
  engineId: string,
): boolean {
  const key = normalizeMediaType(mediaType)
  if (!key) return false
  if (preferences.removed[key]?.includes(engineId)) return true
  for (const ancestor of mediaTypeAncestors(key)) {
    if (preferences.removed[ancestor]?.includes(engineId)) return true
  }
  return false
}

/** 精确类型级别已屏蔽的引擎清单（Display 管理 UI 用；不含父链继承项）。 */
export function getRemovedEngineAssociations(
  preferences: EnginePreferences,
  mediaType: string,
): readonly string[] {
  const key = normalizeMediaType(mediaType)
  return key ? (preferences.removed[key] ?? []) : []
}

/** 小型同步 store；存储后端由调用方注入，SSR/测试可传 undefined。 */
export class EnginePreferenceStore {
  #preferences: EnginePreferences

  constructor(
    private readonly storage?: EnginePreferenceStorage,
    private readonly storageKey = ENGINE_PREFERENCES_STORAGE_KEY,
  ) {
    this.#preferences = readEnginePreferences(storage, storageKey)
  }

  snapshot(): EnginePreferences {
    return this.#preferences
  }

  reload(): EnginePreferences {
    this.#preferences = readEnginePreferences(this.storage, this.storageKey)
    return this.#preferences
  }

  setFile(ref: FileRef, engineId: string | null): boolean {
    this.#preferences = withFileEnginePreference(this.#preferences, ref, engineId)
    return writeEnginePreferences(this.storage, this.#preferences, this.storageKey)
  }

  setMediaType(mediaType: string, engineId: string | null): boolean {
    this.#preferences = withMediaTypeEnginePreference(this.#preferences, mediaType, engineId)
    return writeEnginePreferences(this.storage, this.#preferences, this.storageKey)
  }

  removeAssociation(mediaType: string, engineId: string): boolean {
    this.#preferences = withEngineAssociationRemoved(this.#preferences, mediaType, engineId)
    return writeEnginePreferences(this.storage, this.#preferences, this.storageKey)
  }

  restoreAssociation(mediaType: string, engineId: string): boolean {
    this.#preferences = withEngineAssociationRestored(this.#preferences, mediaType, engineId)
    return writeEnginePreferences(this.storage, this.#preferences, this.storageKey)
  }

  clear(): boolean {
    this.#preferences = emptyEnginePreferences()
    if (!this.storage) return false
    try {
      this.storage.removeItem(this.storageKey)
      return true
    } catch {
      return false
    }
  }
}
