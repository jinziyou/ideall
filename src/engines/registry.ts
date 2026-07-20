import type { EngineDescriptor, EngineMatcher } from "@protocol/engine"
import type { IdeallFile } from "@protocol/file-system"
import { matchEngineDescriptor, type EngineMatchResult } from "./matcher"
import {
  emptyEnginePreferences,
  getFileEnginePreference,
  getMediaTypeEnginePreference,
  isEngineAssociationRemoved,
  type EnginePreferences,
} from "./preferences"

export type EngineCandidate = EngineMatchResult &
  Readonly<{
    priority: number
  }>

export type EngineResolutionSource = "file-preference" | "media-type-preference" | "priority"

export type EngineResolution = EngineCandidate &
  Readonly<{
    source: EngineResolutionSource
  }>

function compareIds(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareCandidates(left: EngineCandidate, right: EngineCandidate): number {
  return (
    right.priority - left.priority ||
    right.specificity - left.specificity ||
    compareIds(left.descriptor.engineId, right.descriptor.engineId)
  )
}

export function listMatchingEngines(
  descriptors: Iterable<EngineDescriptor>,
  file: IdeallFile,
): EngineCandidate[] {
  const candidates: EngineCandidate[] = []
  for (const descriptor of descriptors) {
    const match = matchEngineDescriptor(descriptor, file)
    if (!match) continue
    candidates.push({ ...match, priority: descriptor.priority ?? 0 })
  }
  return candidates.sort(compareCandidates)
}

/**
 * Removed Associations（mimeapps.list 语义）：从候选中剔除被屏蔽的引擎（沿 subclass
 * 父链生效）。守卫：屏蔽不得清空候选——全部候选都被屏蔽时屏蔽失效，保留原列表
 * （至少留下通用兜底引擎，文件不会因此打不开）。
 */
export function filterRemovedEngineAssociations(
  candidates: readonly EngineCandidate[],
  preferences: EnginePreferences,
  mediaType: string,
): EngineCandidate[] {
  const filtered = candidates.filter(
    (candidate) =>
      !isEngineAssociationRemoved(preferences, mediaType, candidate.descriptor.engineId),
  )
  return filtered.length > 0 ? [...filtered] : [...candidates]
}

/**
 * 默认引擎的唯一解析入口：单文件偏好 > media type 偏好 > priority。
 * 指向已卸载或不再匹配的引擎偏好会被忽略，而不是让文件无法打开。
 * 单文件偏好是逐文件显式选择，先于类型级屏蔽判定；屏蔽只作用于
 * media type 偏好与 priority 两层（EnginePicker 候选列表同样经此过滤）。
 */
export function resolveDefaultEngine(
  descriptors: Iterable<EngineDescriptor>,
  file: IdeallFile,
  preferences: EnginePreferences = emptyEnginePreferences(),
): EngineResolution | null {
  const matching = listMatchingEngines(descriptors, file)
  if (matching.length === 0) return null

  const byIdUnfiltered = new Map(
    matching.map((candidate) => [candidate.descriptor.engineId, candidate]),
  )
  const filePreference = getFileEnginePreference(preferences, file.ref)
  const fileCandidate = filePreference ? byIdUnfiltered.get(filePreference) : undefined
  if (fileCandidate) return { ...fileCandidate, source: "file-preference" }

  const candidates = filterRemovedEngineAssociations(matching, preferences, file.mediaType)
  const byId = new Map(candidates.map((candidate) => [candidate.descriptor.engineId, candidate]))
  const mediaTypePreference = getMediaTypeEnginePreference(preferences, file.mediaType)
  const mediaTypeCandidate = mediaTypePreference ? byId.get(mediaTypePreference) : undefined
  if (mediaTypeCandidate) return { ...mediaTypeCandidate, source: "media-type-preference" }

  return { ...candidates[0], source: "priority" }
}

export class EngineRegistryError extends Error {
  constructor(
    readonly code: "duplicate-engine" | "invalid-descriptor",
    message: string,
  ) {
    super(message)
    this.name = "EngineRegistryError"
  }
}

const MAX_ENGINE_ID_LENGTH = 160
const MAX_ENGINE_LABEL_LENGTH = 256
const MAX_ICON_HINT_LENGTH = 160
const MAX_MATCHER_ITEMS = 128
const MAX_MATCHER_TEXT_LENGTH = 512
const MAX_MATCHER_PROPERTIES = 128
const ENGINE_DESCRIPTOR_KEYS = new Set([
  "engineId",
  "label",
  "match",
  "priority",
  "layout",
  "access",
  "suspension",
  "supportsStandaloneWindow",
  "iconHint",
])
const ENGINE_MATCHER_KEYS = new Set(["kinds", "mediaTypes", "requiredCapabilities", "properties"])

function invalidDescriptor(field: string, message: string): never {
  throw new EngineRegistryError("invalid-descriptor", `Engine descriptor ${field} ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function boundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function snapshotStringArray(
  value: unknown,
  field: string,
  accepts: (item: string) => boolean = () => true,
): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_MATCHER_ITEMS) {
    invalidDescriptor(field, `must be an array of at most ${MAX_MATCHER_ITEMS} strings`)
  }
  const snapshot = value.map((item, index) => {
    if (!boundedText(item, MAX_MATCHER_TEXT_LENGTH) || !accepts(item)) {
      invalidDescriptor(`${field}[${index}]`, "contains an invalid value")
    }
    return item
  })
  return Object.freeze(snapshot)
}

function snapshotProperties(value: unknown): EngineMatcher["properties"] {
  if (value === undefined) return undefined
  if (!isRecord(value)) invalidDescriptor("match.properties", "must be a plain object")
  const entries = Object.entries(value)
  if (entries.length > MAX_MATCHER_PROPERTIES) {
    invalidDescriptor("match.properties", `must contain at most ${MAX_MATCHER_PROPERTIES} entries`)
  }
  const snapshot: Record<string, string | number | boolean | null> = Object.create(null)
  for (const [key, property] of entries) {
    if (!boundedText(key, MAX_MATCHER_TEXT_LENGTH)) {
      invalidDescriptor("match.properties", "contains an invalid key")
    }
    if (
      property !== null &&
      typeof property !== "string" &&
      typeof property !== "boolean" &&
      !(typeof property === "number" && Number.isFinite(property))
    ) {
      invalidDescriptor(`match.properties.${key}`, "must be a scalar value")
    }
    if (typeof property === "string" && property.length > MAX_MATCHER_TEXT_LENGTH) {
      invalidDescriptor(`match.properties.${key}`, "string value is too long")
    }
    snapshot[key] = property
  }
  return Object.freeze(snapshot)
}

function snapshotMatcher(matcher: EngineMatcher | undefined): EngineMatcher | undefined {
  if (matcher === undefined) return undefined
  if (!isRecord(matcher)) invalidDescriptor("match", "must be a plain object")
  for (const key of Reflect.ownKeys(matcher)) {
    if (typeof key !== "string" || !ENGINE_MATCHER_KEYS.has(key)) {
      invalidDescriptor("match", `contains unsupported field ${String(key)}`)
    }
  }
  const kinds = snapshotStringArray(
    matcher.kinds,
    "match.kinds",
    (kind) => kind === "file" || kind === "directory",
  ) as EngineMatcher["kinds"]
  const mediaTypes = snapshotStringArray(matcher.mediaTypes, "match.mediaTypes")
  const requiredCapabilities = snapshotStringArray(
    matcher.requiredCapabilities,
    "match.requiredCapabilities",
  )
  const properties = snapshotProperties(matcher.properties)
  return Object.freeze({
    ...(kinds === undefined ? {} : { kinds }),
    ...(mediaTypes === undefined ? {} : { mediaTypes }),
    ...(requiredCapabilities === undefined ? {} : { requiredCapabilities }),
    ...(properties === undefined ? {} : { properties }),
  })
}

function snapshotDescriptor(descriptor: EngineDescriptor): EngineDescriptor {
  if (!isRecord(descriptor)) invalidDescriptor("value", "must be a plain object")
  for (const key of Reflect.ownKeys(descriptor)) {
    if (typeof key !== "string" || !ENGINE_DESCRIPTOR_KEYS.has(key)) {
      invalidDescriptor("value", `contains unsupported field ${String(key)}`)
    }
  }
  if (!boundedText(descriptor.engineId, MAX_ENGINE_ID_LENGTH)) {
    invalidDescriptor("engineId", "must be non-empty, bounded and have no surrounding whitespace")
  }
  if (!boundedText(descriptor.label, MAX_ENGINE_LABEL_LENGTH)) {
    invalidDescriptor("label", "must be non-empty, bounded and have no surrounding whitespace")
  }
  if (descriptor.priority !== undefined && !Number.isFinite(descriptor.priority)) {
    invalidDescriptor("priority", "must be finite")
  }
  if (descriptor.layout !== "padded" && descriptor.layout !== "fill") {
    invalidDescriptor("layout", "must be padded or fill")
  }
  if (descriptor.access !== "read-only" && descriptor.access !== "read-write") {
    invalidDescriptor("access", "must be read-only or read-write")
  }
  if (descriptor.suspension !== undefined && descriptor.suspension !== "serializable") {
    invalidDescriptor("suspension", "must be serializable when provided")
  }
  if (
    descriptor.supportsStandaloneWindow !== undefined &&
    typeof descriptor.supportsStandaloneWindow !== "boolean"
  ) {
    invalidDescriptor("supportsStandaloneWindow", "must be boolean when provided")
  }
  if (
    descriptor.iconHint !== undefined &&
    !boundedText(descriptor.iconHint, MAX_ICON_HINT_LENGTH)
  ) {
    invalidDescriptor("iconHint", "must be a bounded string when provided")
  }
  const match = snapshotMatcher(descriptor.match)
  return Object.freeze({
    engineId: descriptor.engineId,
    label: descriptor.label,
    ...(match === undefined ? {} : { match }),
    ...(descriptor.priority === undefined ? {} : { priority: descriptor.priority }),
    layout: descriptor.layout,
    access: descriptor.access,
    ...(descriptor.suspension === undefined ? {} : { suspension: descriptor.suspension }),
    ...(descriptor.supportsStandaloneWindow === undefined
      ? {}
      : { supportsStandaloneWindow: descriptor.supportsStandaloneWindow }),
    ...(descriptor.iconHint === undefined ? {} : { iconHint: descriptor.iconHint }),
  })
}

/** Runtime preflight entry point; performs the same fail-closed checks used by register(). */
export function validateEngineDescriptor(descriptor: EngineDescriptor): void {
  snapshotDescriptor(descriptor)
}

export class EngineRegistry {
  readonly #descriptors = new Map<string, EngineDescriptor>()
  readonly #listeners = new Set<() => void>()
  #revision = 0
  #batchDepth = 0
  #notificationPending = false

  register(descriptor: EngineDescriptor): () => void {
    const stored = snapshotDescriptor(descriptor)
    if (this.#descriptors.has(stored.engineId)) {
      throw new EngineRegistryError(
        "duplicate-engine",
        `Engine already registered: ${stored.engineId}`,
      )
    }
    this.#descriptors.set(stored.engineId, stored)
    this.#notify()

    return () => {
      if (this.#descriptors.get(stored.engineId) !== stored) return
      this.#descriptors.delete(stored.engineId)
      this.#notify()
    }
  }

  get(engineId: string): EngineDescriptor | null {
    return this.#descriptors.get(engineId) ?? null
  }

  list(): EngineDescriptor[] {
    return [...this.#descriptors.values()].sort((left, right) =>
      compareIds(left.engineId, right.engineId),
    )
  }

  matching(file: IdeallFile): EngineCandidate[] {
    return listMatchingEngines(this.#descriptors.values(), file)
  }

  resolve(
    file: IdeallFile,
    preferences: EnginePreferences = emptyEnginePreferences(),
  ): EngineResolution | null {
    return resolveDefaultEngine(this.#descriptors.values(), file, preferences)
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  revision(): number {
    return this.#revision
  }

  /**
   * Defers registry notifications until a synchronous multi-registry mutation is complete.
   * State is still mutated synchronously, so callers must not await inside the operation.
   */
  batch<T>(operation: () => T): T {
    this.#batchDepth += 1
    try {
      return operation()
    } finally {
      this.#batchDepth -= 1
      if (this.#batchDepth === 0 && this.#notificationPending) {
        this.#notificationPending = false
        this.#emit()
      }
    }
  }

  #notify(): void {
    if (this.#batchDepth > 0) {
      this.#notificationPending = true
      return
    }
    this.#emit()
  }

  #emit(): void {
    this.#revision += 1
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch {
        // 观察者不是事务参与者，不能把已提交的 descriptor 变更变成半失败。
      }
    }
  }
}
