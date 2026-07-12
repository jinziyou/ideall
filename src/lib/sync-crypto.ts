// 跨端同步的客户端密码学 (浏览器 WebCrypto)。
// 由「同步码」(高熵随机串) 派生 storageId + 加密密钥; 明文 (关注列表) 只在浏览器内 AES-GCM 加密,
// 上传的只有密文 —— wonita 服务读不到内容 (端到端加密)。
import { base64ToBytes, bytesToBase64 } from "@/lib/base64"
import { bytesToHex } from "@/lib/hex"

const SALT = "wonita-sync"
const INFO_ID = "wonita-sync-id-v1"
const INFO_ENC = "wonita-sync-enc-v1"
// 笔记走独立的加密块 (不同 storageId + 独立密钥), 与关注互不覆盖。
const INFO_ID_NOTES = "wonita-sync-notes-id-v1"
const INFO_ENC_NOTES = "wonita-sync-notes-enc-v1"

/** 同步域: 关注与笔记各占一个加密块 (不同 storageId)。默认 "subs" 保持关注旧 storageId 不变。 */
export type SyncScope = "subs" | "notes"

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

/**
 * 由同步码派生 storageId (服务端查找键, 不可逆推同步码) 与 AES-GCM 密钥 (仅本地)。
 * scope 选择同步域: "subs" (默认, 关注; storageId 与历史一致) / "notes" (笔记, 独立块与密钥)。
 */
export async function deriveKeys(code: string, scope: SyncScope = "subs"): Promise<DerivedKeys> {
  const ikm = await crypto.subtle.importKey("raw", enc(normalizeCode(code)), "HKDF", false, [
    "deriveBits",
    "deriveKey",
  ])
  const infoId = scope === "notes" ? INFO_ID_NOTES : INFO_ID
  const infoEnc = scope === "notes" ? INFO_ENC_NOTES : INFO_ENC
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

export async function encryptJson(key: CryptoKey, value: unknown): Promise<Encrypted> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc(JSON.stringify(value)))
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ct)) }
}

export async function decryptJson<T>(key: CryptoKey, iv: string, ciphertext: string): Promise<T> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext),
  )
  return JSON.parse(td.decode(pt)) as T
}
