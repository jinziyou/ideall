// 跨端同步的客户端密码学 (浏览器 WebCrypto)。
// 由「同步码」(高熵随机串) 派生 storageId + 加密密钥; 明文 (关注列表) 只在浏览器内 AES-GCM 加密,
// 上传的只有密文 —— wonita 服务读不到内容 (端到端加密)。
import type { SyncBlockBudget } from "@protocol/sync"
import { SYNC_MAX_PARTITION } from "@protocol/sync"
import { base64ToBytes, bytesToBase64, isBase64 } from "@/lib/base64"
import { bytesToHex } from "@/lib/hex"

const SALT = "wonita-sync"
const INFO_ID = "wonita-sync-id-v1"
const INFO_ENC = "wonita-sync-enc-v1"
// 笔记、书签各走独立加密块 (不同 storageId + 独立密钥), 与关注互不覆盖。
const INFO_ID_NOTES = "wonita-sync-notes-id-v1"
const INFO_ENC_NOTES = "wonita-sync-notes-enc-v1"
const INFO_ID_BOOKMARKS = "wonita-sync-bookmarks-id-v1"
const INFO_ENC_BOOKMARKS = "wonita-sync-bookmarks-enc-v1"

/** 每个同步域占一个加密块。默认 "subs" 保持关注旧 storageId 不变。 */
export type SyncScope = "subs" | "notes" | "bookmarks"

export type SyncPartition = number

const td = new TextDecoder()

// 返回 ArrayBuffer 支撑的 Uint8Array, 以满足 WebCrypto 的 BufferSource (TS 5.7 起区分 ArrayBufferLike)。
function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>
}

/** 生成高熵同步码: 16 字节随机 → 32 位 hex, 每 8 位用 - 分组便于复制。 */
export function generateSyncCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return bytesToHex(bytes).replace(/(.{8})(?=.)/g, "$1-")
}

/** 规整同步码: 去掉非 hex 字符并小写, 保证两端派生一致。 */
function normalizeCode(code: string): string {
  return code.replace(/[^0-9a-fA-F]/g, "").toLowerCase()
}

/** 同步码是否合法 (32 位 hex = 16 字节)。 */
export function isValidSyncCode(code: string): boolean {
  return normalizeCode(code).length === 32
}

export type DerivedKeys = { storageId: string; key: CryptoKey }

export class SyncBlockLimitError extends Error {
  override name = "SyncBlockLimitError"
}

export function isValidSyncPartition(partition: unknown): partition is SyncPartition {
  return (
    Number.isSafeInteger(partition) &&
    (partition as number) >= 0 &&
    (partition as number) <= SYNC_MAX_PARTITION
  )
}

/**
 * 由同步码派生 storageId (服务端查找键, 不可逆推同步码) 与 AES-GCM 密钥 (仅本地)。
 * scope 选择同步域；默认关注域的 storageId 与历史一致，其它域使用独立块与密钥。
 */
export async function deriveKeys(
  code: string,
  scope: SyncScope = "subs",
  partition: SyncPartition = 0,
): Promise<DerivedKeys> {
  if (!isValidSyncPartition(partition)) throw new Error("同步分片编号无效")
  const ikm = await crypto.subtle.importKey("raw", enc(normalizeCode(code)), "HKDF", false, [
    "deriveBits",
    "deriveKey",
  ])
  const baseInfoId =
    scope === "notes" ? INFO_ID_NOTES : scope === "bookmarks" ? INFO_ID_BOOKMARKS : INFO_ID
  const baseInfoEnc =
    scope === "notes" ? INFO_ENC_NOTES : scope === "bookmarks" ? INFO_ENC_BOOKMARKS : INFO_ENC
  // partition=0 必须保持历史 HKDF info 不变；非零分片才加稳定后缀。
  const infoId = partition === 0 ? baseInfoId : `${baseInfoId}:partition:${partition}`
  const infoEnc = partition === 0 ? baseInfoEnc : `${baseInfoEnc}:partition:${partition}`
  const idBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: enc(SALT), info: enc(infoId) },
    ikm,
    128,
  )
  const storageId = bytesToHex(new Uint8Array(idBits))
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc(SALT), info: enc(infoEnc) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
  return { storageId, key }
}

export type Encrypted = { iv: string; ciphertext: string }

function jsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return enc(JSON.stringify(value))
}

export function assertSyncJsonBudget(value: unknown, budget: SyncBlockBudget): number {
  const bytes = jsonBytes(value).byteLength
  if (bytes > budget.maxPlaintextBytes) {
    throw new SyncBlockLimitError(
      `同步数据超过单块上限（${bytes} 字节，最大 ${budget.maxPlaintextBytes} 字节）`,
    )
  }
  return bytes
}

export async function encryptJson(
  key: CryptoKey,
  value: unknown,
  budget?: SyncBlockBudget,
): Promise<Encrypted> {
  const plaintext = jsonBytes(value)
  if (budget && plaintext.byteLength > budget.maxPlaintextBytes) {
    throw new SyncBlockLimitError(
      `同步数据超过单块上限（${plaintext.byteLength} 字节，最大 ${budget.maxPlaintextBytes} 字节）`,
    )
  }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ct)) }
}

export async function decryptJson<T>(
  key: CryptoKey,
  iv: string,
  ciphertext: string,
  budget?: SyncBlockBudget,
): Promise<T> {
  if (
    !isBase64(iv) ||
    base64ToBytes(iv).byteLength !== 12 ||
    !isBase64(ciphertext) ||
    (budget && ciphertext.length > budget.maxCiphertextBase64Chars)
  ) {
    throw new SyncBlockLimitError("同步密文格式无效或超过单块上限")
  }
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext),
  )
  if (budget && pt.byteLength > budget.maxPlaintextBytes) {
    throw new SyncBlockLimitError("同步明文超过单块上限")
  }
  return JSON.parse(td.decode(pt)) as T
}
