// 单域加密 blob 同步编排 (关注 / 笔记共用) —— GET→解密→合并→GC→写本地→PUT, 409 有界重试。
// 由 sync-domain-machine (XState) 驱动; 本文件保持纯函数、可单测, 不依赖 xstate。
import type { SyncRecord, SyncResult } from "@protocol/sync"
import { recordsEqual, isLive } from "@protocol/sync"
import { decryptJson, deriveKeys, encryptJson, isValidSyncCode } from "@/lib/sync-crypto"
import { getSyncBlob, putSyncBlob } from "./sync-api"

/** 同步推送的最大尝试次数: 每次 409 后重新 GET→合并→PUT。 */
export const SYNC_MAX_ATTEMPTS = 4

export type DomainSyncConfig<T extends SyncRecord> = {
  /** deriveKeys 的 scope (笔记域传 "notes")。 */
  keyScope?: "notes"
  listLocal: () => Promise<T[]>
  merge: (accumulated: T[], remote: T[]) => T[]
  gc: (merged: T[], now: number) => T[]
  bulkPut: (items: T[]) => Promise<void>
  isValidRemote: (item: unknown, now: number) => item is T
}

export type DomainSyncContext<T extends SyncRecord> = {
  code: string
  storageId: string
  key: CryptoKey
  now: number
  localAll: T[]
  merged: T[]
  attempt: number
}

export type PrepareResult<T extends SyncRecord> = Pick<
  DomainSyncContext<T>,
  "storageId" | "key" | "now" | "localAll" | "merged"
>

export type AttemptOutcome<T extends SyncRecord = SyncRecord> =
  | { type: "complete"; result: SyncResult }
  | { type: "retry"; merged: T[] }
  | { type: "fail"; message: string }

/** 校验同步码并派生密钥、读本地全集 (含删除标记)。 */
export async function prepareDomainSync<T extends SyncRecord>(
  code: string,
  config: DomainSyncConfig<T>,
): Promise<PrepareResult<T>> {
  if (!isValidSyncCode(code)) throw new Error("同步码格式不正确")
  const { storageId, key } = await deriveKeys(code, config.keyScope)
  const now = Date.now()
  const localAll = await config.listLocal()
  return { storageId, key, now, localAll, merged: localAll }
}

function countSyncResult<T extends SyncRecord>(localAll: T[], kept: T[]): SyncResult {
  const localLiveIds = new Set(localAll.filter(isLive).map((s) => s.id))
  const mergedLive = kept.filter(isLive)
  const added = mergedLive.filter((s) => !localLiveIds.has(s.id)).length
  return { total: mergedLive.length, added }
}

/** 执行一次 GET→合并→PUT 尝试; 409 且未耗尽重试 → retry, 成功 → complete。 */
export async function runDomainSyncAttempt<T extends SyncRecord>(
  ctx: DomainSyncContext<T>,
  config: DomainSyncConfig<T>,
): Promise<AttemptOutcome> {
  const got = await getSyncBlob(ctx.storageId)
  if (!got.ok) return { type: "fail", message: got.message }

  const base = got.data?.updated_at ?? 0
  let remote: T[] = []
  let remoteDirty = false
  if (got.data) {
    try {
      const decoded = await decryptJson<unknown[]>(ctx.key, got.data.iv, got.data.ciphertext)
      if (Array.isArray(decoded)) {
        remote = decoded.filter((x) => config.isValidRemote(x, ctx.now))
        remoteDirty = remote.length !== decoded.length
      } else {
        remoteDirty = true
      }
    } catch {
      return { type: "fail", message: "解密失败：同步码可能不一致" }
    }
  }

  const merged = config.merge(ctx.merged, remote)
  const kept = config.gc(merged, Date.now())
  if (!recordsEqual(kept, ctx.localAll)) {
    await config.bulkPut(kept)
  }

  if (!remoteDirty && recordsEqual(kept, remote)) {
    return { type: "complete", result: countSyncResult(ctx.localAll, kept) }
  }

  const enc = await encryptJson(ctx.key, kept)
  const put = await putSyncBlob(
    ctx.storageId,
    { iv: enc.iv, ciphertext: enc.ciphertext, updated_at: Date.now() },
    base,
  )
  if (put.ok) {
    return { type: "complete", result: countSyncResult(ctx.localAll, kept) }
  }
  if (put.status === 409 && ctx.attempt < SYNC_MAX_ATTEMPTS) {
    return { type: "retry", merged }
  }
  if (put.status === 409) {
    return { type: "fail", message: "同步冲突: 多端同时修改, 请稍后重试" }
  }
  return { type: "fail", message: put.message }
}
