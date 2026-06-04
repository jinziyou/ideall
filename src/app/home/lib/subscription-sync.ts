// 订阅跨端同步编排 (本地优先 + 端到端加密)。
// 同步码存本地 localStorage; 同步时拉远端密文 → 解密 → 与本地并集合并 → 写本地 → 加密 → 推远端。
// 合并按 id 取并集 (本地优先), 删除为尽力 (并集会从另一端重新带回已删项)。

import type { Subscription } from "../model"
import { bulkPutSubscriptions, listSubscriptions } from "./subscriptions-store"
import { decryptJson, deriveKeys, encryptJson, isValidSyncCode } from "./sync"
import { getSyncBlob, putSyncBlob } from "./sync-action"

const CODE_KEY = "wonita:sync:code"
const codeListeners = new Set<() => void>()

export function getSyncCode(): string | null {
  try {
    return localStorage.getItem(CODE_KEY)
  } catch {
    return null
  }
}

/** 订阅同步码变化 (供 useSyncExternalStore); 写入/清除时通知。 */
export function subscribeSyncCode(cb: () => void): () => void {
  codeListeners.add(cb)
  return () => {
    codeListeners.delete(cb)
  }
}

export function setSyncCode(code: string): void {
  try {
    localStorage.setItem(CODE_KEY, code)
  } catch {
    /* 隐私模式 / 配额: 忽略 */
  }
  codeListeners.forEach((l) => l())
}

export function clearSyncCode(): void {
  try {
    localStorage.removeItem(CODE_KEY)
  } catch {
    /* ignore */
  }
  codeListeners.forEach((l) => l())
}

/** 按 id 取并集 (同 id 本地优先), 保证两端最终趋于一致。 */
function unionMerge(local: Subscription[], remote: Subscription[]): Subscription[] {
  const map = new Map<string, Subscription>()
  for (const s of remote) map.set(s.id, s)
  for (const s of local) map.set(s.id, s) // 本地优先
  return [...map.values()]
}

export type SyncResult = { total: number; added: number }

/** 执行一次同步。失败抛 Error (含可展示消息)。 */
export async function syncNow(code: string): Promise<SyncResult> {
  if (!isValidSyncCode(code)) throw new Error("同步码格式不正确")
  const { storageId, key } = await deriveKeys(code)

  const local = await listSubscriptions()

  let remote: Subscription[] = []
  const got = await getSyncBlob(storageId)
  if (!got.ok) throw new Error(got.message)
  if (got.data) {
    try {
      const decoded = await decryptJson<Subscription[]>(key, got.data.iv, got.data.ciphertext)
      if (Array.isArray(decoded)) remote = decoded
    } catch {
      throw new Error("解密失败: 同步码可能不一致")
    }
  }

  const merged = unionMerge(local, remote)
  if (merged.length > local.length) {
    await bulkPutSubscriptions(merged)
  }

  const enc = await encryptJson(key, merged)
  const put = await putSyncBlob(storageId, {
    iv: enc.iv,
    ciphertext: enc.ciphertext,
    updated_at: Date.now(),
  })
  if (!put.ok) throw new Error(put.message)

  return { total: merged.length, added: Math.max(0, merged.length - local.length) }
}
