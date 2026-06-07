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
