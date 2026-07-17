/**
 * 借 shared-mime-info 的 `<sub-class-of>` 建立的媒体类型层级（docs/freedesktop-alignment.md §3）。
 *
 * 关键约束：
 * - subclass 关系只来自下面的显式表，**不做任何隐式 suffix（+xml/+json）推导**；
 * - `application/vnd.ideall.*` 语义类型不进表、无父类——语义引擎隔离性不被层级穿透；
 * - 不引入 freedesktop 的默认父类规则（未登记类型一律 subclass application/octet-stream）：
 *   引擎面里没有任何引擎声明 octet-stream，text/* 通配已直接覆盖 text 类型，默认规则无匹配增益。
 */

export function normalizeMediaType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

function freezeParents(
  table: Record<string, readonly string[]>,
): Readonly<Record<string, readonly string[]>> {
  const frozen: Record<string, readonly string[]> = Object.create(null)
  for (const [type, parents] of Object.entries(table)) {
    frozen[type] = Object.freeze([...parents])
  }
  return Object.freeze(frozen)
}

/** 显式 subclass 表：child → parents（近亲在前）。仅标准内容类型。 */
export const MEDIA_TYPE_PARENTS: Readonly<Record<string, readonly string[]>> = freezeParents({
  "text/markdown": ["text/plain"],
  "text/csv": ["text/plain"],
  "text/uri-list": ["text/plain"],
  "application/json": ["text/plain"],
  "application/javascript": ["text/plain"],
  "application/typescript": ["text/plain"],
  "application/xml": ["text/plain"],
  "image/svg+xml": ["application/xml"],
  "application/yaml": ["text/plain"],
  "application/toml": ["text/plain"],
  "application/ld+json": ["application/json"],
})

/** 防御上界：表损坏或意外成环时，祖先枚举不会失控。匹配计分本身会把远距离命中折损为不匹配。 */
export const MAX_MEDIA_TYPE_ANCESTORS = 16

export type MediaTypeAncestor = Readonly<{
  mediaType: string
  /** BFS 距离：直接父类为 1，祖父类为 2，以此类推。 */
  distance: number
}>

/** 父链枚举（BFS，近→远，环安全，数量封顶），不含自身；输入先做 normalizeMediaType。 */
export function mediaTypeAncestorsWithDistance(mediaType: string): readonly MediaTypeAncestor[] {
  const start = normalizeMediaType(mediaType)
  if (!start) return []
  const ancestors: MediaTypeAncestor[] = []
  const visited = new Set([start])
  let frontier = [start]
  let distance = 0
  while (frontier.length > 0 && ancestors.length < MAX_MEDIA_TYPE_ANCESTORS) {
    distance += 1
    const next: string[] = []
    for (const type of frontier) {
      for (const parent of MEDIA_TYPE_PARENTS[type] ?? []) {
        if (visited.has(parent)) continue
        visited.add(parent)
        ancestors.push({ mediaType: parent, distance })
        next.push(parent)
        if (ancestors.length >= MAX_MEDIA_TYPE_ANCESTORS) break
      }
    }
    frontier = next
  }
  return ancestors
}

/** 仅类型名的父链（近→远），供偏好查找等不需要距离的消费方使用。 */
export function mediaTypeAncestors(mediaType: string): readonly string[] {
  return mediaTypeAncestorsWithDistance(mediaType).map((ancestor) => ancestor.mediaType)
}
