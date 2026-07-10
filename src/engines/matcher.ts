import type { EngineDescriptor } from "@protocol/engine"
import type { IdeallFile } from "@protocol/file-system"

export type EngineMatchResult = Readonly<{
  descriptor: EngineDescriptor
  specificity: number
}>

export function normalizeMediaType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

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

/** 返回 MIME 模式的匹配特异度；不匹配时返回 null。 */
export function matchMediaTypePattern(pattern: string, mediaType: string): number | null {
  const normalizedPattern = normalizeMediaType(pattern)
  const normalizedType = normalizeMediaType(mediaType)
  if (!normalizedPattern || !normalizedType) return null
  if (normalizedPattern === "*" || normalizedPattern === "*/*") return 1
  if (!normalizedPattern.includes("*")) {
    return normalizedPattern === normalizedType ? 400 : null
  }
  if (!wildcardMatches(normalizedPattern, normalizedType)) return null

  const literalLength = normalizedPattern.replaceAll("*", "").length
  return normalizedPattern.endsWith("/*") ? 200 + literalLength : 300 + literalLength
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
