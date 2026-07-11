import type { EngineDescriptor, EngineMatcher } from "@protocol/engine"
import type { IdeallFile } from "@protocol/file-system"
import { matchEngineDescriptor, type EngineMatchResult } from "./matcher"
import {
  emptyEnginePreferences,
  getFileEnginePreference,
  getMediaTypeEnginePreference,
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
 * 默认引擎的唯一解析入口：单文件偏好 > media type 偏好 > priority。
 * 指向已卸载或不再匹配的引擎偏好会被忽略，而不是让文件无法打开。
 */
export function resolveDefaultEngine(
  descriptors: Iterable<EngineDescriptor>,
  file: IdeallFile,
  preferences: EnginePreferences = emptyEnginePreferences(),
): EngineResolution | null {
  const candidates = listMatchingEngines(descriptors, file)
  if (candidates.length === 0) return null
  const byId = new Map(candidates.map((candidate) => [candidate.descriptor.engineId, candidate]))

  const filePreference = getFileEnginePreference(preferences, file.ref)
  const fileCandidate = filePreference ? byId.get(filePreference) : undefined
  if (fileCandidate) return { ...fileCandidate, source: "file-preference" }

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

function snapshotMatcher(matcher: EngineMatcher | undefined): EngineMatcher | undefined {
  if (!matcher) return undefined
  return Object.freeze({
    ...matcher,
    kinds: matcher.kinds ? Object.freeze([...matcher.kinds]) : undefined,
    mediaTypes: matcher.mediaTypes ? Object.freeze([...matcher.mediaTypes]) : undefined,
    requiredCapabilities: matcher.requiredCapabilities
      ? Object.freeze([...matcher.requiredCapabilities])
      : undefined,
    properties: matcher.properties ? Object.freeze({ ...matcher.properties }) : undefined,
  })
}

function snapshotDescriptor(descriptor: EngineDescriptor): EngineDescriptor {
  if (!descriptor.engineId.trim() || descriptor.engineId !== descriptor.engineId.trim()) {
    throw new EngineRegistryError(
      "invalid-descriptor",
      "Engine descriptor engineId must be non-empty and have no surrounding whitespace",
    )
  }
  if (!descriptor.label.trim()) {
    throw new EngineRegistryError("invalid-descriptor", "Engine descriptor label must not be empty")
  }
  if (descriptor.priority !== undefined && !Number.isFinite(descriptor.priority)) {
    throw new EngineRegistryError("invalid-descriptor", "Engine descriptor priority must be finite")
  }
  return Object.freeze({ ...descriptor, match: snapshotMatcher(descriptor.match) })
}

export class EngineRegistry {
  readonly #descriptors = new Map<string, EngineDescriptor>()
  readonly #listeners = new Set<() => void>()
  #revision = 0

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

  #notify(): void {
    this.#revision += 1
    for (const listener of this.#listeners) listener()
  }
}
