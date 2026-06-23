// 跨端同步契约 —— 加密同步块的形状 + 纯合并逻辑 (LWW 并集)。
// AES/HKDF 密码学与编排在 sync 插件内; 此处只放跨端共享的契约与可独立单测的纯逻辑。
import type { Subscription } from "./subscription"

/** 服务端不透明存储的加密同步块 (PUT/GET /sync/{id})。 */
export type SyncBlob = { iv: string; ciphertext: string; updated_at: number }

/** 一次同步的结果摘要。 */
export type SyncResult = { total: number; added: number }

/** 跨端同步端口 —— sync 插件实现 (编排: 拉远端→解密→合并→写本地→加密→推远端)。 */
export interface SyncPort {
  syncNow(code: string): Promise<SyncResult>
}

let syncPort: SyncPort | null = null

/** sync 插件在启动时注册其实现。 */
export function registerSyncPort(p: SyncPort): void {
  syncPort = p
}

/** 取同步端口 (core 的同步面板用); 未注册 (无 sync 插件) 时为 null。 */
export function getSyncPort(): SyncPort | null {
  return syncPort
}

/** 单条订阅的「版本时间」(LWW 比较用; updatedAt 缺省回退 createdAt, 兼容存量)。 */
function subTs(s: Subscription): number {
  return s.updatedAt ?? s.createdAt
}

/**
 * 按 id 取并集, 同 id 取 updatedAt 较新者胜 (LWW; 并列本地优先, 保证稳定)。
 * 旧实现无条件本地优先, 会静默丢弃远端对已有订阅的字段更新。
 *
 * 墓碑 (deletedAt 已设, 见 Subscription) 也只是一条 Subscription, 原样参与同一 LWW:
 * 删除 (removeSubscription 写墓碑并 bump updatedAt) 较新 → 墓碑胜 → 删除跨端收敛 (不再被对端复活);
 * 删除后又重新订阅 (addSubscription 清除 deletedAt 并 bump updatedAt) 较新 → 活跃项胜 → 复活。
 * 调用方读路径需自行过滤墓碑 (见 isLive); 过期墓碑由 pruneExpiredTombstones GC。
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

// ── 墓碑 (tombstone) GC ────────────────────────────────────────────────────────────
// 删除以墓碑保留, 而非物理删, 以便跨端传播删除。墓碑需在所有端都见过该删除后才可安全清除;
// 保留期取足够长 (远超任何合理的多端离线窗口), 之后物理 GC, 避免墓碑无限累积撑大同步块。
// 取舍记录见 docs/sync-lww-tradeoff.md。

/** 墓碑保留期: 90 天。超过即视为所有端已收敛, 可安全物理清除。 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** 是否为墓碑 (软删除项)。 */
export function isTombstone(s: Subscription): boolean {
  return s.deletedAt != null
}

/** 是否为活跃订阅 (非墓碑) —— 读路径过滤用。 */
export function isLive(s: Subscription): boolean {
  return s.deletedAt == null
}

/** 墓碑是否已过保留期 (now − deletedAt > ttl), 可安全 GC; 非墓碑恒 false。now 注入便于测试。 */
export function isExpiredTombstone(
  s: Subscription,
  now: number,
  ttlMs = TOMBSTONE_TTL_MS,
): boolean {
  return s.deletedAt != null && now - s.deletedAt > ttlMs
}

/**
 * GC: 移除已过保留期的墓碑; 活跃订阅与未过期墓碑保留。纯函数 (now 注入)。
 * 同步落地前对合并结果调用, 使本地与远端同步块都不再携带过期墓碑。
 */
export function pruneExpiredTombstones(
  subs: Subscription[],
  now: number,
  ttlMs = TOMBSTONE_TTL_MS,
): Subscription[] {
  return subs.filter((s) => !isExpiredTombstone(s, now, ttlMs))
}

/**
 * 落地侧物理删除候选 id: 库中**当前**已过保留期、且不在本批写入集合 (keepIds) 里的墓碑。
 * 据「落地时刻真实库状态」而非同步快照判定 —— 故绝不删:
 *   - 同步往返窗口内并发新增的活跃订阅 (它非墓碑, 本轮未上传, 下轮自然带上);
 *   - 正被写回的复活项 / 并发写入的新墓碑 (在 keepIds 里, 或尚未过期)。
 * 仅清掉「kept 已 prune 掉、库里残留」的过期墓碑, 使本地随远端同步块一起收敛。
 */
export function expiredTombstoneIdsToDelete(
  existing: Subscription[],
  keepIds: Set<string>,
  now: number,
  ttlMs = TOMBSTONE_TTL_MS,
): string[] {
  return existing
    .filter((s) => isExpiredTombstone(s, now, ttlMs) && !keepIds.has(s.id))
    .map((s) => s.id)
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
