// 单域加密 blob 同步编排 (关注 / 笔记 / 书签共用) —— GET→解密→合并→GC→写本地→PUT。
// 由 sync-domain-machine (XState) 驱动; 本文件保持纯函数、可单测, 不依赖 xstate。
import type { SyncBlockBudget, SyncRecord, SyncResult } from "@protocol/sync"
import { recordsEqual, isLive } from "@protocol/sync"
import {
  decryptJson,
  deriveKeys,
  encryptJson,
  assertSyncJsonBudget,
  isValidSyncCode,
  SyncBlockLimitError,
  type SyncPartition,
  type SyncScope,
} from "@/lib/sync-crypto"
import { getSyncBlob, putSyncBlob } from "./sync-api"

/** 同步推送的最大尝试次数: 每次 409 后重新 GET→合并→PUT。 */
export const SYNC_MAX_ATTEMPTS = 4

export type DomainSyncConfig<T extends SyncRecord> = {
  /** deriveKeys 的独立加密域；省略时保持历史关注域。 */
  keyScope?: SyncScope
  /** 0 保持历史 storageId；为未来服务端兼容分片预留稳定派生边界。 */
  partition?: SyncPartition
  budget: SyncBlockBudget
  listLocal: () => Promise<T[]>
  merge: (accumulated: T[], remote: T[]) => T[]
  gc: (merged: T[], now: number) => T[]
  /** CAS 落地并返回 Storage 规范化后的实际提交快照。 */
  bulkPut: (items: T[], expectedLocal: T[]) => Promise<T[]>
  isValidRemote: (item: unknown, now: number) => item is T
}

export type DomainSyncContext<T extends SyncRecord> = {
  code: string
  storageId: string
  key: CryptoKey
  now: number
  /** 同步开始时的统计基线；重试期间保持不变。 */
  localAll: T[]
  /** Storage 当前应有的快照；每次成功 bulkPut 后推进，供下一次 CAS。 */
  localSnapshot: T[]
  merged: T[]
  attempt: number
}

export type PrepareResult<T extends SyncRecord> = Pick<
  DomainSyncContext<T>,
  "storageId" | "key" | "now" | "localAll" | "localSnapshot" | "merged"
>

export type AttemptOutcome<T extends SyncRecord = SyncRecord> =
  | { type: "complete"; result: SyncResult }
  | { type: "retry"; merged: T[]; localSnapshot: T[] }
  | { type: "fail"; message: string }

/** 校验同步码并派生密钥、读本地全集 (含删除标记)。 */
export async function prepareDomainSync<T extends SyncRecord>(
  code: string,
  config: DomainSyncConfig<T>,
): Promise<PrepareResult<T>> {
  if (!isValidSyncCode(code)) throw new Error("同步码格式不正确")
  const { storageId, key } = await deriveKeys(code, config.keyScope, config.partition)
  const now = Date.now()
  const localAll = await config.listLocal()
  if (localAll.length > config.budget.maxRecords) {
    throw new SyncBlockLimitError(
      `本地同步记录超过单块上限（${localAll.length} 条，最大 ${config.budget.maxRecords} 条）`,
    )
  }
  assertSyncJsonBudget(localAll, config.budget)
  return { storageId, key, now, localAll, localSnapshot: localAll, merged: localAll }
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
): Promise<AttemptOutcome<T>> {
  const got = await getSyncBlob(ctx.storageId)
  if (!got.ok) return { type: "fail", message: got.message }

  const base = got.data?.updated_at ?? 0
  let remote: T[] = []
  let remoteDirty = false
  if (got.data) {
    try {
      const decoded = await decryptJson<unknown[]>(
        ctx.key,
        got.data.iv,
        got.data.ciphertext,
        config.budget,
      )
      if (Array.isArray(decoded)) {
        if (decoded.length > config.budget.maxRecords) {
          return {
            type: "fail",
            message: `远端同步记录超过单块上限（${decoded.length} 条，最大 ${config.budget.maxRecords} 条）`,
          }
        }
        remote = decoded.filter((x) => config.isValidRemote(x, ctx.now))
        remoteDirty = remote.length !== decoded.length
      } else {
        remoteDirty = true
      }
    } catch (error) {
      if (error instanceof SyncBlockLimitError) {
        return { type: "fail", message: error.message }
      }
      return { type: "fail", message: "解密失败：同步码可能不一致" }
    }
  }

  const merged = config.merge(ctx.merged, remote)
  const kept = config.gc(merged, Date.now())
  if (kept.length > config.budget.maxRecords) {
    return {
      type: "fail",
      message: `合并后同步记录超过单块上限（${kept.length} 条，最大 ${config.budget.maxRecords} 条）`,
    }
  }
  try {
    assertSyncJsonBudget(kept, config.budget)
  } catch (error) {
    return {
      type: "fail",
      message: error instanceof Error ? error.message : "同步数据超过单块上限",
    }
  }
  let localSnapshot = ctx.localSnapshot
  if (!recordsEqual(kept, localSnapshot)) {
    localSnapshot = await config.bulkPut(kept, localSnapshot)
  }

  if (!remoteDirty && recordsEqual(localSnapshot, remote)) {
    return { type: "complete", result: countSyncResult(ctx.localAll, localSnapshot) }
  }

  let enc: Awaited<ReturnType<typeof encryptJson>>
  try {
    if (localSnapshot.length > config.budget.maxRecords) {
      throw new SyncBlockLimitError("存储规范化后的同步记录超过单块上限")
    }
    enc = await encryptJson(ctx.key, localSnapshot, config.budget)
  } catch (error) {
    return {
      type: "fail",
      message: error instanceof Error ? error.message : "同步数据超过单块上限",
    }
  }
  const put = await putSyncBlob(
    ctx.storageId,
    { iv: enc.iv, ciphertext: enc.ciphertext, updated_at: Date.now() },
    base,
  )
  if (put.ok) {
    return { type: "complete", result: countSyncResult(ctx.localAll, localSnapshot) }
  }
  if (put.status === 409 && ctx.attempt < SYNC_MAX_ATTEMPTS) {
    return { type: "retry", merged: localSnapshot, localSnapshot }
  }
  if (put.status === 409) {
    return { type: "fail", message: "同步冲突: 多端同时修改, 请稍后重试" }
  }
  return { type: "fail", message: put.message }
}
