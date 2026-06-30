// 跨端同步契约 —— 加密同步块的形状 + 纯合并逻辑 (LWW 并集)。
// AES/HKDF 密码学与编排在 sync 插件内; 此处只放跨端共享的契约与可独立单测的纯逻辑。
//
// 合并逻辑对「可同步记录」泛型化 (SyncRecord): 关注 (Subscription) 与笔记 (Note) 等本地优先实体
// 都满足该形状 (id + 版本时间 + 软删墓碑), 故共用同一套 LWW 并集 / 墓碑 GC, 不各写一份。

/**
 * 可跨端同步的记录的最小形状 —— LWW 合并只需: 主键 id、版本时间 (updatedAt)、软删墓碑 (deletedAt)。
 * 关注 / 笔记等实体结构上满足即可参与同一套合并。
 */
export interface SyncRecord {
  id: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

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

/** 单条记录的「版本时间」(LWW 比较用)。 */
function recordTs(s: SyncRecord): number {
  return s.updatedAt
}

/**
 * 允许的时钟前偏移: 接受不超过 now + 此值的时间戳, 容多端 NTP 漂移, 拒绝更远的未来。
 * 取 1 天 (远大于任何合理时钟漂移), 仍足以瓦解「远未来时间戳永久钉死 LWW」攻击 ——
 * 被投毒项的领先优势至多维持约 1 天, 其后正常 (now 时间戳) 的编辑/删除即可盖过。
 */
export const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000

/**
 * 同步时间戳合理性: 有限非负数字, 且不超过 now + 容许时钟偏移。now 注入便于测试。
 * 防御「持正确同步码但失陷/老旧的对端上传远未来时间戳」—— 它会永远赢得 recordTs LWW,
 * 钉死一条被投毒的记录, 或造一条 GC 永远清不掉、合法删除/复活也盖不过的不死墓碑。
 * 入站校验 (isValidRemoteSub/isValidRemoteNote) 用它对每条远端记录的时间戳设上界。
 */
export function isSaneSyncTimestamp(ts: unknown, now: number): boolean {
  return typeof ts === "number" && Number.isFinite(ts) && ts >= 0 && ts <= now + MAX_FUTURE_SKEW_MS
}

/**
 * 按 id 取并集, 同 id 取 updatedAt 较新者胜 (LWW; 并列本地优先, 保证稳定)。
 * 旧实现无条件本地优先, 会静默丢弃远端对已有关注的字段更新。
 *
 * 墓碑 (deletedAt 已设, 见 Subscription) 也只是一条 Subscription, 原样参与同一 LWW:
 * 删除 (removeSubscription 写墓碑并 bump updatedAt) 较新 → 墓碑胜 → 删除跨端收敛 (不再被对端复活);
 * 删除后又重新关注 (addSubscription 清除 deletedAt 并 bump updatedAt) 较新 → 活跃项胜 → 复活。
 * 调用方读路径需自行过滤墓碑 (见 isLive); 过期墓碑由 pruneExpiredTombstones GC。
 */
export function unionMerge<T extends SyncRecord>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>()
  for (const s of remote) map.set(s.id, s)
  for (const s of local) {
    const r = map.get(s.id)
    if (!r || recordTs(s) >= recordTs(r)) map.set(s.id, s) // 本地更新或并列 → 本地胜
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
export function isTombstone(s: SyncRecord): boolean {
  return s.deletedAt != null
}

/** 是否为活跃记录 (非墓碑) —— 读路径过滤用。 */
export function isLive(s: SyncRecord): boolean {
  return s.deletedAt == null
}

/** 墓碑是否已过保留期 (now − deletedAt > ttl), 可安全 GC; 非墓碑恒 false。now 注入便于测试。 */
export function isExpiredTombstone(s: SyncRecord, now: number, ttlMs = TOMBSTONE_TTL_MS): boolean {
  return s.deletedAt != null && now - s.deletedAt > ttlMs
}

/**
 * GC: 移除已过保留期的墓碑; 活跃记录与未过期墓碑保留。纯函数 (now 注入)。
 * 同步落地前对合并结果调用, 使本地与远端同步块都不再携带过期墓碑。
 */
export function pruneExpiredTombstones<T extends SyncRecord>(
  records: T[],
  now: number,
  ttlMs = TOMBSTONE_TTL_MS,
): T[] {
  return records.filter((s) => !isExpiredTombstone(s, now, ttlMs))
}

/**
 * 落地侧物理删除候选 id: 库中**当前**已过保留期、且不在本批写入集合 (keepIds) 里的墓碑。
 * 据「落地时刻真实库状态」而非同步快照判定 —— 故绝不删:
 *   - 同步往返窗口内并发新增的活跃关注 (它非墓碑, 本轮未上传, 下轮自然带上);
 *   - 正被写回的复活项 / 并发写入的新墓碑 (在 keepIds 里, 或尚未过期)。
 * 仅清掉「kept 已 prune 掉、库里残留」的过期墓碑, 使本地随远端同步块一起收敛。
 */
export function expiredTombstoneIdsToDelete(
  existing: SyncRecord[],
  keepIds: Set<string>,
  now: number,
  ttlMs = TOMBSTONE_TTL_MS,
): string[] {
  return existing
    .filter((s) => isExpiredTombstone(s, now, ttlMs) && !keepIds.has(s.id))
    .map((s) => s.id)
}

/** 两记录集合是否等价 (按 id 排序后逐项比较), 用于决定是否写回本地。 */
export function recordsEqual<T extends SyncRecord>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  const norm = (xs: T[]) =>
    [...xs].sort((x, y) => x.id.localeCompare(y.id)).map((s) => JSON.stringify(s))
  const na = norm(a)
  const nb = norm(b)
  return na.every((v, i) => v === nb[i])
}

/** @deprecated 用 recordsEqual; 保留别名以兼容关注同步路径与现有测试。 */
export const subsEqual = recordsEqual
