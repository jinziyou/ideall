import type { EngineDescriptor } from "@protocol/engine"
import type { IdeallFile } from "@protocol/file-system"
import { mediaTypeAncestorsWithDistance, normalizeMediaType } from "./media-type-tree"

export { normalizeMediaType } from "./media-type-tree"

export type EngineMatchResult = Readonly<{
  descriptor: EngineDescriptor
  specificity: number
}>

/** 父链命中每远一级，匹配特异度折损；折损后 ≤0 视为不匹配（docs/freedesktop-alignment.md §3.3）。 */
export const SUBCLASS_DISTANCE_PENALTY = 150

function wildcardMatches(pattern: string, value: string): boolean {
  const parts = pattern.split("*")
  if (parts.length === 1) return pattern === value

  let cursor = 0
  if (parts[0]) {
    if (!value.startsWith(parts[0])) return false
    cursor = parts[0].length
  }

  for (let index = 1; index < parts.length - 1; index += 1) {
    const part = parts[index]
    if (!part) continue
    const found = value.indexOf(part, cursor)
    if (found < 0) return false
    cursor = found + part.length
  }

  const suffix = parts.at(-1) ?? ""
  return !suffix || (value.endsWith(suffix) && value.length - suffix.length >= cursor)
}

/** 归一化后的 pattern 对归一化后的具体类型的直接命中分；不匹配时返回 null。 */
function directMediaTypeScore(normalizedPattern: string, normalizedType: string): number | null {
  if (normalizedPattern === "*" || normalizedPattern === "*/*") return 1
  if (!normalizedPattern.includes("*")) {
    return normalizedPattern === normalizedType ? 400 : null
  }
  if (!wildcardMatches(normalizedPattern, normalizedType)) return null

  const literalLength = normalizedPattern.replaceAll("*", "").length
  return normalizedPattern.endsWith("/*") ? 200 + literalLength : 300 + literalLength
}

/**
 * 返回 MIME 模式的匹配特异度；不匹配时返回 null。
 * 直接未命中时沿显式 subclass 父链上溯（shared-mime-info sub-class-of），
 * 取折损后最高的命中；父链命中永远低于同模式的直接命中，不改变精确声明的优先级。
 */
export function matchMediaTypePattern(pattern: string, mediaType: string): number | null {
  const normalizedPattern = normalizeMediaType(pattern)
  const normalizedType = normalizeMediaType(mediaType)
  if (!normalizedPattern || !normalizedType) return null
  const direct = directMediaTypeScore(normalizedPattern, normalizedType)
  if (direct !== null) return direct

  let best: number | null = null
  for (const ancestor of mediaTypeAncestorsWithDistance(normalizedType)) {
    const score = directMediaTypeScore(normalizedPattern, ancestor.mediaType)
    if (score === null) continue
    const discounted = score - SUBCLASS_DISTANCE_PENALTY * ancestor.distance
    if (discounted > 0 && (best === null || discounted > best)) best = discounted
  }
  return best
}

export function matchEngineDescriptor(
  descriptor: EngineDescriptor,
  file: IdeallFile,
): EngineMatchResult | null {
  const matcher = descriptor.match
  if (!matcher) return { descriptor, specificity: 0 }

  let specificity = 0

  if (matcher.kinds) {
    if (!matcher.kinds.includes(file.kind)) return null
    specificity += 40
  }

  if (matcher.mediaTypes) {
    let bestMediaTypeMatch: number | null = null
    for (const pattern of matcher.mediaTypes) {
      const score = matchMediaTypePattern(pattern, file.mediaType)
      if (score !== null && (bestMediaTypeMatch === null || score > bestMediaTypeMatch)) {
        bestMediaTypeMatch = score
      }
    }
    if (bestMediaTypeMatch === null) return null
    specificity += bestMediaTypeMatch
  }

  if (matcher.requiredCapabilities) {
    const available = new Set(file.capabilities)
    if (matcher.requiredCapabilities.some((capability) => !available.has(capability))) return null
    specificity += new Set(matcher.requiredCapabilities).size * 5
  }

  if (matcher.properties) {
    const properties = file.properties ?? {}
    for (const [key, expected] of Object.entries(matcher.properties)) {
      if (!Object.hasOwn(properties, key) || !Object.is(properties[key], expected)) {
        return null
      }
    }
    specificity += Object.keys(matcher.properties).length * 10
  }

  return { descriptor, specificity }
}
