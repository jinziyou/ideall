import type { FileRef } from "@protocol/file-system"
import { fileRefKey } from "@protocol/file-system"
import { mediaTypeAncestors } from "./media-type-tree"
import { normalizeMediaType } from "./matcher"

export const ENGINE_PREFERENCES_VERSION = 1 as const
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
}>

export type EnginePreferenceStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function frozenPreferences(
  files: Record<string, string>,
  mediaTypes: Record<string, string>,
): EnginePreferences {
  return Object.freeze({
    version: ENGINE_PREFERENCES_VERSION,
    files: Object.freeze(files),
    mediaTypes: Object.freeze(mediaTypes),
  })
}

export function emptyEnginePreferences(): EnginePreferences {
  return frozenPreferences({}, {})
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

export function parseEnginePreferences(raw: string | null | undefined): EnginePreferences {
  if (!raw) return emptyEnginePreferences()
  try {
    const value = asRecord(JSON.parse(raw))
    if (!value || value.version !== ENGINE_PREFERENCES_VERSION) return emptyEnginePreferences()
    return frozenPreferences(
      sanitizePreferenceMap(value.files),
      sanitizeMediaTypeMap(value.mediaTypes),
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
  return frozenPreferences(files, { ...preferences.mediaTypes })
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
  return frozenPreferences({ ...preferences.files }, mediaTypes)
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
