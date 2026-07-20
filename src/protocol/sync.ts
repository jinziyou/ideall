// 跨端同步接口约定 —— 加密同步块的形状 + 纯合并逻辑 (LWW 并集)。
// AES/HKDF 密码学与编排在 sync 插件内; 此处只放跨端共享的接口约定与可独立单测的纯逻辑。
//
// 合并逻辑对「可同步记录」泛型化 (SyncRecord): 关注、笔记、书签等本地优先实体
// 都满足该形状 (id + 版本时间 + 软删除标记), 故共用同一套 LWW 并集 / 删除标记 GC, 不各写一份。

/**
 * 可跨端同步的记录的最小形状 —— LWW 合并只需: 主键 id、版本时间 (updatedAt)、软删除标记 (deletedAt)。
 * 关注 / 笔记 / 书签等实体结构上满足即可参与同一套合并。
 */
export interface SyncRecord {
  id: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

/** 服务端不透明存储的加密同步块 (PUT/GET /sync/{id})。 */
export type SyncBlob = { iv: string; ciphertext: string; updated_at: number }

/** V2 分区快照的原子可见性指针。 */
export type SyncManifest = {
  generation: string
  part_count: number
  total_ciphertext_chars: number
  parts_sha256: string
  version: number
  updated_at_ms: number
}

/** V2 已提交 generation 中的一个不可变密文分片。 */
export type SyncGenerationPart = {
  generation: string
  part_index: number
  iv: string
  ciphertext: string
  content_sha256: string
}

export type SyncBlockBudget = Readonly<{
  maxRecords: number
  maxPlaintextBytes: number
  maxCiphertextBase64Chars: number
}>

const MIB = 1024 * 1024

function syncBlockBudget(maxRecords: number, maxPlaintextBytes: number): SyncBlockBudget {
  return Object.freeze({
    maxRecords,
    maxPlaintextBytes,
    // AES-GCM 在明文后追加 16-byte tag，再按 Base64 4/3 膨胀。
    maxCiphertextBase64Chars: 4 * Math.ceil((maxPlaintextBytes + 16) / 3),
  })
}

/** 单块客户端硬预算；服务端仍只看见不透明密文。 */
export const SYNC_BLOCK_BUDGETS = Object.freeze({
  subs: syncBlockBudget(50_000, 4 * MIB),
  notes: syncBlockBudget(100_000, 32 * MIB),
  bookmarks: syncBlockBudget(100_000, 16 * MIB),
})

/** 服务端每片的 canonical Base64 字符上限。 */
export const SYNC_PART_MAX_CIPHERTEXT_CHARS = 262_144

/** 扣除 16-byte AES-GCM tag 后，可在上述 Base64 上限内装下的最大明文。 */
export const SYNC_PART_MAX_PLAINTEXT_BYTES = 196_592

/** 单个分片响应上限（密文 + JSON 包装/元数据余量）。 */
export const SYNC_MAX_RESPONSE_BYTES = SYNC_PART_MAX_CIPHERTEXT_CHARS + 8_192

/** 分片 0 保持历史 storageId；未来新增分片只可使用 1..1023。 */
export const SYNC_MAX_PARTITION = 1_023

/** 一次同步的结果摘要。 */
export type SyncResult = { total: number; added: number }

export type SyncFailureCode = "block-limit" | "conflict" | "decrypt" | "network" | "unknown"

export type SyncTelemetrySnapshot = Readonly<{
  status: "success" | "failure"
  startedAt: number
  finishedAt: number
  durationMs: number
  total: number | null
  added: number | null
  failureCode: SyncFailureCode | null
}>

let syncTelemetrySnapshot: SyncTelemetrySnapshot | null = null
const syncTelemetryListeners = new Set<() => void>()

/** 最近一次同步的非敏感运行指标；只驻留当前进程，不包含同步码、storageId 或错误正文。 */
export function getSyncTelemetrySnapshot(): SyncTelemetrySnapshot | null {
  return syncTelemetrySnapshot
}

export function recordSyncTelemetry(snapshot: SyncTelemetrySnapshot): void {
  syncTelemetrySnapshot = Object.freeze({ ...snapshot })
  for (const listener of syncTelemetryListeners) listener()
}

export function subscribeSyncTelemetry(listener: () => void): () => void {
  syncTelemetryListeners.add(listener)
  return () => syncTelemetryListeners.delete(listener)
}

/** 跨端同步端口 —— sync 插件实现 (编排: 拉远端→解密→合并→写本地→加密→推远端)。 */
export interface SyncPort {
  syncNow(code: string): Promise<SyncResult>
}

let syncPort: SyncPort | null = null

/** sync 插件在启动时注册其实现。 */
export function registerSyncPort(p: SyncPort): () => void {
  const previous = syncPort
  syncPort = p
  return () => {
    if (syncPort === p) syncPort = previous
  }
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
 * 钉死一条被投毒的记录, 或造一条 GC 永远清不掉、合法删除/恢复也盖不过的不死删除标记。
 * 入站校验 (isValidRemoteSub/isValidRemoteNote) 用它对每条远端记录的时间戳设上界。
 */
export function isSaneSyncTimestamp(ts: unknown, now: number): boolean {
  return typeof ts === "number" && Number.isFinite(ts) && ts >= 0 && ts <= now + MAX_FUTURE_SKEW_MS
}

/**
 * 按 id 取并集, 同 id 取 updatedAt 较新者胜 (LWW; 并列本地优先, 保证稳定)。
 * 旧实现无条件本地优先, 会静默丢弃远端对已有关注的字段更新。
 *
 * 删除标记 (deletedAt 已设, 见 Subscription) 也只是一条 Subscription, 原样参与同一 LWW:
 * 删除 (removeSubscription 写删除标记并 bump updatedAt) 较新 → 删除标记胜 → 删除跨端收敛 (不再被对端恢复);
 * 删除后又重新关注 (addSubscription 清除 deletedAt 并 bump updatedAt) 较新 → 活跃项胜 → 恢复。
 * 调用方读路径需自行过滤删除标记 (见 isLive); 过期删除标记由 pruneExpiredTombstones GC。
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

// ── 删除标记 (tombstone) GC ────────────────────────────────────────────────────────────
// 删除以删除标记保留, 而非物理删, 以便跨端传播删除。删除标记需在所有端都见过该删除后才可安全清除;
// 保留期取足够长 (远超任何合理的多端离线窗口), 之后物理 GC, 避免删除标记无限累积撑大同步块。
// 取舍记录见 docs/sync-lww-tradeoff.md。

/** 删除标记保留期: 90 天。超过即视为所有端已收敛, 可安全物理清除。 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** 是否为删除标记 (软删除项)。 */
export function isTombstone(s: SyncRecord): boolean {
  return s.deletedAt != null
}

/** 是否为活跃记录 (非删除标记) —— 读路径过滤用。 */
export function isLive(s: SyncRecord): boolean {
  return s.deletedAt == null
}

/** 删除标记是否已过保留期 (now − deletedAt > ttl), 可安全 GC; 非删除标记恒 false。now 注入便于测试。 */
export function isExpiredTombstone(s: SyncRecord, now: number, ttlMs = TOMBSTONE_TTL_MS): boolean {
  return s.deletedAt != null && now - s.deletedAt > ttlMs
}

/**
 * GC: 移除已过保留期的删除标记; 活跃记录与未过期删除标记保留。纯函数 (now 注入)。
 * 同步落地前对合并结果调用, 使本地与远端同步块都不再携带过期删除标记。
 */
export function pruneExpiredTombstones<T extends SyncRecord>(
  records: T[],
  now: number,
  ttlMs = TOMBSTONE_TTL_MS,
): T[] {
  return records.filter((s) => !isExpiredTombstone(s, now, ttlMs))
}

/**
 * 落地侧物理删除候选 id: 库中**当前**已过保留期、且不在本批写入集合 (keepIds) 里的删除标记。
 * 据「落地时刻真实库状态」而非同步快照判定 —— 故绝不删:
 *   - 同步往返窗口内并发新增的活跃关注 (它非删除标记, 本轮未上传, 下轮自然带上);
 *   - 正被写回的恢复项 / 并发写入的新删除标记 (在 keepIds 里, 或尚未过期)。
 * 仅清掉「kept 已 prune 掉、库里残留」的过期删除标记, 使本地随远端同步块一起收敛。
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

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (!value || typeof value !== "object") return value
  const source = value as Record<string, unknown>
  const canonical: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    if (source[key] !== undefined) canonical[key] = canonicalJsonValue(source[key])
  }
  return canonical
}

/** 两记录集合是否结构等价 (记录按 id、对象字段按键规范化；数组顺序保留)。 */
export function recordsEqual<T extends SyncRecord>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  const norm = (xs: T[]) =>
    [...xs]
      .sort((x, y) => x.id.localeCompare(y.id))
      .map((record) => JSON.stringify(canonicalJsonValue(record)))
  const na = norm(a)
  const nb = norm(b)
  return na.every((v, i) => v === nb[i])
}
