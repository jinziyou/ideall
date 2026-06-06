// 订阅跨端合并的纯逻辑 (无 IndexedDB / 网络副作用, 可独立单测)。
import type { Subscription } from "../model"

/** 单条订阅的"版本时间"(LWW 比较用; updatedAt 缺省回退 createdAt, 兼容存量)。 */
function subTs(s: Subscription): number {
  return s.updatedAt ?? s.createdAt
}

/**
 * 按 id 取并集, 同 id 取 updatedAt 较新者胜 (LWW; 并列本地优先, 保证稳定)。
 * 旧实现无条件本地优先, 会静默丢弃远端对已有订阅的字段更新。
 */
export function unionMerge(local: Subscription[], remote: Subscription[]): Subscription[] {
  const map = new Map<string, Subscription>()
  for (const s of remote) map.set(s.id, s)
  for (const s of local) {
    const r = map.get(s.id)
    if (!r || subTs(s) >= subTs(r)) map.set(s.id, s) // 本地更新或并列 → 本地胜
  }
  return [...map.values()]
}

/** 两订阅集合是否等价 (按 id 排序后逐项比较), 用于决定是否写回本地。 */
export function subsEqual(a: Subscription[], b: Subscription[]): boolean {
  if (a.length !== b.length) return false
  const norm = (xs: Subscription[]) =>
    [...xs].sort((x, y) => x.id.localeCompare(y.id)).map((s) => JSON.stringify(s))
  const na = norm(a)
  const nb = norm(b)
  return na.every((v, i) => v === nb[i])
}
