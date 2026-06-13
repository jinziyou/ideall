// 跨端同步的客户端密码学 (浏览器 WebCrypto)。
// 由「同步码」(高熵随机串) 派生 storageId + 加密密钥; 明文 (订阅列表) 只在浏览器内 AES-GCM 加密,
// 上传的只有密文 —— super/server 读不到内容 (端到端加密)。

const SALT = "wonita-sync"
const INFO_ID = "wonita-sync-id-v1"
const INFO_ENC = "wonita-sync-enc-v1"

const td = new TextDecoder()

// 返回 ArrayBuffer 支撑的 Uint8Array, 以满足 WebCrypto 的 BufferSource (TS 5.7 起区分 ArrayBufferLike)。
function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

function toBase64(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** 生成高熵同步码: 16 字节随机 → 32 位 hex, 每 8 位用 - 分组便于复制。 */
export function generateSyncCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return toHex(bytes).replace(/(.{8})(?=.)/g, "$1-")
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

/** 由同步码派生 storageId (服务端查找键, 不可逆推同步码) 与 AES-GCM 密钥 (仅本地)。 */
export async function deriveKeys(code: string): Promise<DerivedKeys> {
  const ikm = await crypto.subtle.importKey("raw", enc(normalizeCode(code)), "HKDF", false, [
    "deriveBits",
    "deriveKey",
  ])
  const idBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: enc(SALT), info: enc(INFO_ID) },
    ikm,
    128,
  )
  const storageId = toHex(new Uint8Array(idBits))
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc(SALT), info: enc(INFO_ENC) },
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
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ct)) }
}

export async function decryptJson<T>(key: CryptoKey, iv: string, ciphertext: string): Promise<T> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext),
  )
  return JSON.parse(td.decode(pt)) as T
}
