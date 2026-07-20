// 单域加密快照同步（关注 / 笔记 / 书签共用）。
//
// 读：manifest → 并发拉取已提交 parts → 逐片 AES-GCM 解密 → 合并 / GC / 本地 CAS。
// 写：JSON UTF-8 按字节切片 → 每片独立密钥与 IV 加密 → 上传新 generation → manifest CAS 原子发布。
import {
  SYNC_MAX_PARTITION,
  SYNC_PART_MAX_CIPHERTEXT_CHARS,
  SYNC_PART_MAX_PLAINTEXT_BYTES,
  type SyncBlockBudget,
  type SyncManifest,
  type SyncRecord,
  type SyncResult,
} from "@protocol/sync"
import { recordsEqual, isLive } from "@protocol/sync"
import {
  assertSyncJsonBudget,
  decryptBytes,
  decryptJson,
  deriveKeys,
  encryptBytes,
  isValidSyncCode,
  SyncBlockLimitError,
  type SyncScope,
} from "@/lib/sync-crypto"
import { bytesToHex } from "@/lib/hex"
import {
  commitSyncManifest,
  discardSyncGeneration,
  getSyncGenerationPart,
  getSyncManifest,
  putSyncGenerationPart,
} from "./sync-api"

/** 同步尝试上限：manifest 409 或读取期间 generation 被替换时重新拉取。 */
export const SYNC_MAX_ATTEMPTS = 4
const PART_IO_CONCURRENCY = 6
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder("utf-8", { fatal: true })
const SHA256_HEX = /^[0-9a-f]{64}$/
const DECRYPT_FAILURE_MESSAGE = "解密失败：同步码可能不一致"

export type DomainSyncConfig<T extends SyncRecord> = {
  /** deriveKeys 的独立加密域；省略时保持历史关注域。 */
  keyScope?: SyncScope
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

type LoadedRemote<T extends SyncRecord> = {
  records: T[]
  dirty: boolean
  /** manifest CAS 基线；无分区快照时为 0。 */
  version: number
  /** 只读到旧单 blob 时必须立即发布成 V2 分区快照。 */
  needsMigration: boolean
}

class SyncTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

class SyncGenerationChangedError extends Error {}

class SyncDecryptError extends Error {}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value))
  return bytesToHex(new Uint8Array(digest))
}

async function decryptRemote<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof SyncBlockLimitError) throw error
    throw new SyncDecryptError()
  }
}

/** 校验同步码并派生根 storageId/第 0 片密钥，读本地全集（含删除标记）。 */
export async function prepareDomainSync<T extends SyncRecord>(
  code: string,
  config: DomainSyncConfig<T>,
): Promise<PrepareResult<T>> {
  if (!isValidSyncCode(code)) throw new Error("同步码格式不正确")
  const { storageId, key } = await deriveKeys(code, config.keyScope, 0)
  const now = Date.now()
  const localAll = await config.listLocal()
  if (localAll.length > config.budget.maxRecords) {
    throw new SyncBlockLimitError(
      `本地同步记录超过域上限（${localAll.length} 条，最大 ${config.budget.maxRecords} 条）`,
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

function transportMessage(error: SyncTransportError): string {
  if (error.status === 401 || error.status === 403) {
    return "跨端同步已升级为账号绑定，请先登录"
  }
  if (error.status === 413 || error.status === 422) return "同步数据超过服务端配额"
  if (error.status === 429) return "同步请求过于频繁，请稍后重试"
  return error.message
}

function validateManifest(value: SyncManifest): void {
  if (
    !/^[0-9a-f]{32}$/.test(value.generation) ||
    !Number.isSafeInteger(value.part_count) ||
    value.part_count < 1 ||
    value.part_count > SYNC_MAX_PARTITION + 1 ||
    !Number.isSafeInteger(value.total_ciphertext_chars) ||
    value.total_ciphertext_chars < 0 ||
    value.total_ciphertext_chars > value.part_count * SYNC_PART_MAX_CIPHERTEXT_CHARS ||
    !SHA256_HEX.test(value.parts_sha256) ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    !Number.isSafeInteger(value.updated_at_ms) ||
    value.updated_at_ms < 0
  ) {
    throw new SyncTransportError("服务端返回了无效的同步清单")
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  limit: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await task(values[index]!, index)
    }
  })
  await Promise.all(workers)
  return output
}

function joinPlaintextParts(parts: Uint8Array<ArrayBuffer>[], budget: SyncBlockBudget): unknown[] {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  if (total > budget.maxPlaintextBytes) {
    throw new SyncBlockLimitError(
      `远端同步明文超过域上限（${total} 字节，最大 ${budget.maxPlaintextBytes} 字节）`,
    )
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.byteLength
  }
  const parsed = JSON.parse(textDecoder.decode(joined)) as unknown
  if (!Array.isArray(parsed)) throw new Error("同步快照不是记录数组")
  return parsed
}

async function loadPartitionedRemote<T extends SyncRecord>(
  ctx: DomainSyncContext<T>,
  config: DomainSyncConfig<T>,
  manifest: SyncManifest,
): Promise<LoadedRemote<T>> {
  validateManifest(manifest)
  const indices = Array.from({ length: manifest.part_count }, (_, index) => index)
  const loadedParts = await mapConcurrent(indices, PART_IO_CONCURRENCY, async (partIndex) => {
    const result = await getSyncGenerationPart(ctx.storageId, manifest.generation, partIndex)
    if (!result.ok && result.status === 404) throw new SyncGenerationChangedError()
    if (!result.ok || !result.data) {
      throw new SyncTransportError(
        result.ok ? `同步分片 ${partIndex + 1} 缺失` : result.message,
        result.ok ? undefined : result.status,
      )
    }
    const part = result.data
    if (part.generation !== manifest.generation || part.part_index !== partIndex) {
      throw new SyncTransportError(`同步分片 ${partIndex + 1} 元数据不一致`)
    }
    if (!SHA256_HEX.test(part.content_sha256)) {
      throw new SyncTransportError(`同步分片 ${partIndex + 1} 摘要无效`)
    }
    const contentSha256 = await sha256Hex(`${part.iv}\0${part.ciphertext}`)
    if (contentSha256 !== part.content_sha256) {
      throw new SyncTransportError(`同步分片 ${partIndex + 1} 摘要不一致`)
    }
    const key =
      partIndex === 0 ? ctx.key : (await deriveKeys(ctx.code, config.keyScope, partIndex)).key
    const plaintext = await decryptRemote(() =>
      decryptBytes(key, part.iv, part.ciphertext, SYNC_PART_MAX_CIPHERTEXT_CHARS),
    )
    return { plaintext, contentSha256, ciphertextChars: part.ciphertext.length }
  })
  const totalCiphertextChars = loadedParts.reduce((total, part) => total + part.ciphertextChars, 0)
  if (totalCiphertextChars !== manifest.total_ciphertext_chars) {
    throw new SyncTransportError("同步清单密文大小不一致")
  }
  const partsSha256 = await sha256Hex(
    loadedParts.map((part, index) => `${index}:${part.contentSha256}\n`).join(""),
  )
  if (partsSha256 !== manifest.parts_sha256) {
    throw new SyncTransportError("同步清单分片摘要不一致")
  }
  const decoded = joinPlaintextParts(
    loadedParts.map((part) => part.plaintext),
    config.budget,
  )
  if (decoded.length > config.budget.maxRecords) {
    throw new SyncBlockLimitError(
      `远端同步记录超过域上限（${decoded.length} 条，最大 ${config.budget.maxRecords} 条）`,
    )
  }
  const records = decoded.filter((value) => config.isValidRemote(value, ctx.now))
  return {
    records,
    dirty: records.length !== decoded.length,
    version: manifest.version,
    needsMigration: false,
  }
}

async function loadRemote<T extends SyncRecord>(
  ctx: DomainSyncContext<T>,
  config: DomainSyncConfig<T>,
): Promise<LoadedRemote<T>> {
  const manifestResult = await getSyncManifest(ctx.storageId)
  if (!manifestResult.ok) {
    throw new SyncTransportError(manifestResult.message, manifestResult.status)
  }
  if (manifestResult.data) return loadPartitionedRemote(ctx, config, manifestResult.data)

  return { records: [], dirty: false, version: 0, needsMigration: false }
}

function snapshotBytes<T extends SyncRecord>(records: T[], budget: SyncBlockBudget) {
  assertSyncJsonBudget(records, budget)
  return textEncoder.encode(JSON.stringify(records)) as Uint8Array<ArrayBuffer>
}

function splitPlaintext(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>[] {
  const parts: Uint8Array<ArrayBuffer>[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += SYNC_PART_MAX_PLAINTEXT_BYTES) {
    parts.push(bytes.slice(offset, offset + SYNC_PART_MAX_PLAINTEXT_BYTES))
  }
  // JSON 数组至少有 `[]`；此分支只作为底层不变式保护。
  if (parts.length === 0) parts.push(new Uint8Array(0))
  if (parts.length > SYNC_MAX_PARTITION + 1) {
    throw new SyncBlockLimitError("同步快照分片数超过服务端上限")
  }
  return parts
}

function newGeneration(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
}

async function publishSnapshot<T extends SyncRecord>(
  ctx: DomainSyncContext<T>,
  config: DomainSyncConfig<T>,
  records: T[],
  expected: number,
): Promise<{ ok: true } | { ok: false; status?: number; message: string }> {
  const plaintextParts = splitPlaintext(snapshotBytes(records, config.budget))
  const generation = newGeneration()
  try {
    const encryptedParts = await mapConcurrent(
      plaintextParts,
      PART_IO_CONCURRENCY,
      async (plaintext, partIndex) => {
        const key =
          partIndex === 0 ? ctx.key : (await deriveKeys(ctx.code, config.keyScope, partIndex)).key
        return encryptBytes(key, plaintext, SYNC_PART_MAX_CIPHERTEXT_CHARS)
      },
    )
    await mapConcurrent(encryptedParts, PART_IO_CONCURRENCY, async (part, partIndex) => {
      const result = await putSyncGenerationPart(ctx.storageId, generation, partIndex, part)
      if (!result.ok) throw new SyncTransportError(result.message, result.status)
    })
    const committed = await commitSyncManifest(
      ctx.storageId,
      generation,
      encryptedParts.length,
      expected,
    )
    if (!committed.ok) {
      const failure = {
        ok: false as const,
        status: committed.status,
        message: transportMessage(new SyncTransportError(committed.message, committed.status)),
      }
      // 明确的 4xx 响应表示 CAS 未提交，可直接清理；网络错误、2xx 响应损坏和 5xx
      // 都可能发生在服务端提交之后，必须先回读 manifest 判定。
      if (committed.status !== undefined && committed.status >= 400 && committed.status < 500) {
        await discardSyncGeneration(ctx.storageId, generation).catch(() => undefined)
        return failure
      }
      // 提交请求可能已在服务端成功，但响应在网络中丢失。先回读，避免把已提交
      // generation 误判为失败；若已被其他端推进，则统一转成 CAS 冲突重试。
      const observed = await getSyncManifest(ctx.storageId)
      if (!observed.ok) return failure
      if (observed.data) {
        try {
          validateManifest(observed.data)
        } catch {
          // 无法判断当前可见 generation，不能冒险 DELETE 可能已经提交的分片。
          return failure
        }
      }
      if (observed.data?.generation === generation) {
        return observed.data.part_count === encryptedParts.length &&
          observed.data.version > expected
          ? { ok: true }
          : failure
      }
      if (observed.data && observed.data.version !== expected) {
        await discardSyncGeneration(ctx.storageId, generation).catch(() => undefined)
        return { ok: false, status: 409, message: "同步清单已被其他设备更新" }
      }
      await discardSyncGeneration(ctx.storageId, generation).catch(() => undefined)
      return failure
    }
    return { ok: true }
  } catch (error) {
    await discardSyncGeneration(ctx.storageId, generation).catch(() => undefined)
    if (error instanceof SyncTransportError) {
      return { ok: false, status: error.status, message: transportMessage(error) }
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "上传同步分片失败",
    }
  }
}

/** 执行一次拉取→合并→原子发布尝试；manifest 409 且未耗尽重试 → retry。 */
export async function runDomainSyncAttempt<T extends SyncRecord>(
  ctx: DomainSyncContext<T>,
  config: DomainSyncConfig<T>,
): Promise<AttemptOutcome<T>> {
  let remote: LoadedRemote<T>
  try {
    remote = await loadRemote(ctx, config)
  } catch (error) {
    if (error instanceof SyncGenerationChangedError) {
      return ctx.attempt < SYNC_MAX_ATTEMPTS
        ? { type: "retry", merged: ctx.merged, localSnapshot: ctx.localSnapshot }
        : { type: "fail", message: "远端同步快照持续更新，请稍后重试" }
    }
    if (error instanceof SyncTransportError) {
      return { type: "fail", message: transportMessage(error) }
    }
    if (error instanceof SyncBlockLimitError) return { type: "fail", message: error.message }
    return {
      type: "fail",
      message:
        error instanceof SyncDecryptError ||
        error instanceof SyntaxError ||
        error instanceof TypeError
          ? DECRYPT_FAILURE_MESSAGE
          : error instanceof Error
            ? error.message
            : "拉取同步数据失败",
    }
  }

  const merged = config.merge(ctx.merged, remote.records)
  const kept = config.gc(merged, Date.now())
  if (kept.length > config.budget.maxRecords) {
    return {
      type: "fail",
      message: `合并后同步记录超过域上限（${kept.length} 条，最大 ${config.budget.maxRecords} 条）`,
    }
  }
  try {
    assertSyncJsonBudget(kept, config.budget)
  } catch (error) {
    return {
      type: "fail",
      message: error instanceof Error ? error.message : "同步数据超过域上限",
    }
  }

  let localSnapshot = ctx.localSnapshot
  if (!recordsEqual(kept, localSnapshot)) {
    localSnapshot = await config.bulkPut(kept, localSnapshot)
  }

  if (!remote.dirty && !remote.needsMigration && recordsEqual(localSnapshot, remote.records)) {
    return { type: "complete", result: countSyncResult(ctx.localAll, localSnapshot) }
  }

  const published = await publishSnapshot(ctx, config, localSnapshot, remote.version)
  if (published.ok) {
    return { type: "complete", result: countSyncResult(ctx.localAll, localSnapshot) }
  }
  if (published.status === 409 && ctx.attempt < SYNC_MAX_ATTEMPTS) {
    return { type: "retry", merged: localSnapshot, localSnapshot }
  }
  if (published.status === 409) {
    return { type: "fail", message: "同步冲突: 多端同时修改, 请稍后重试" }
  }
  return { type: "fail", message: published.message }
}
