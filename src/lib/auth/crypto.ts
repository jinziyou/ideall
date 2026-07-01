// 登录密码学 (浏览器): 复刻 wonita 服务 (orion 0.17) 的 X25519 + XChaCha20-Poly1305 方案。
// 共享密钥 = raw X25519(clientPriv, serverPub) (orion key_agreement 不哈希, 仅查低阶点);
// 密码用 XChaCha20-Poly1305 加密, encrypted_password = nonce(24) || 密文 || tag(16) 的 hex。
// 明文密码只在浏览器内加密 —— 上传 wonita 服务时只过密文。
// WebCrypto 无 XChaCha, 故用 @noble (与 orion 字节对齐)。

import { x25519 } from "@noble/curves/ed25519.js"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.trim()
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** 随机会话 id (服务端按它缓存其临时密钥对; GET secret 与 POST 登录须用同一个)。 */
export function newClientId(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)))
}

export type ClientKeypair = { priv: Uint8Array; publicHex: string }

/** 生成客户端 X25519 密钥对; publicHex 作为 client_secret 上传。 */
export function newKeypair(): ClientKeypair {
  const priv = x25519.utils.randomSecretKey()
  return { priv, publicHex: toHex(x25519.getPublicKey(priv)) }
}

/** 用服务端临时公钥加密密码, 返回 encrypted_password 的 hex (nonce||密文||tag)。 */
export function encryptPassword(
  priv: Uint8Array,
  serverPublicHex: string,
  password: string,
): string {
  const shared = x25519.getSharedSecret(priv, fromHex(serverPublicHex)) // raw 32B, 与 orion 对齐
  const nonce = crypto.getRandomValues(new Uint8Array(24))
  const sealed = xchacha20poly1305(shared, nonce).encrypt(new TextEncoder().encode(password)) // 密文||tag
  const out = new Uint8Array(nonce.length + sealed.length)
  out.set(nonce, 0)
  out.set(sealed, nonce.length)
  return toHex(out)
}
