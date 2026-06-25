// 跨端同步密码学纯函数测试 (Node 内建 WebCrypto, 零浏览器/jsdom)。
// 钉死端到端加密的关键契约: 派生确定性 + 归一化 + 加解密往返。
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  deriveKeys,
  encryptJson,
  decryptJson,
  isValidSyncCode,
  generateSyncCode,
} from "./sync-crypto"

const CODE = "1234567890abcdef1234567890abcdef" // 32 hex = 16 字节

test("isValidSyncCode: 32 hex 合法, 短码非法, 生成码合法", () => {
  assert.equal(isValidSyncCode(CODE), true)
  assert.equal(isValidSyncCode("12345678-90abcdef"), false) // 太短
  assert.equal(isValidSyncCode(generateSyncCode()), true) // 生成码含 - 也合法
})

test("deriveKeys: 同码(含分隔符/大小写归一)派生同 storageId, 长度 32 hex", async () => {
  const a = await deriveKeys(CODE)
  const withDashes = await deriveKeys("12345678-90abcdef-12345678-90abcdef")
  const upper = await deriveKeys(CODE.toUpperCase())
  assert.equal(a.storageId.length, 32) // 128 bit → 32 hex
  assert.equal(withDashes.storageId, a.storageId) // 归一化确定性
  assert.equal(upper.storageId, a.storageId)
  // 不同码派生不同 storageId
  const other = await deriveKeys("ffffffffffffffffffffffffffffffff")
  assert.notEqual(other.storageId, a.storageId)
})

test("encryptJson/decryptJson: 往返还原明文, 密文不含明文", async () => {
  const { key } = await deriveKeys(CODE)
  const value = { subs: [{ id: "1", title: "测试订阅标题" }], n: 42 }
  const { iv, ciphertext } = await encryptJson(key, value)
  const back = await decryptJson<typeof value>(key, iv, ciphertext)
  assert.deepEqual(back, value)
  // 密文不应直接暴露明文
  assert.ok(!ciphertext.includes("测试订阅标题"))
})

test("decryptJson: 错误同步码派生的密钥必须解密失败 (端到端隔离)", async () => {
  const { key } = await deriveKeys(CODE)
  const { iv, ciphertext } = await encryptJson(key, { secret: 1 })
  const { key: wrongKey } = await deriveKeys("ffffffffffffffffffffffffffffffff")
  // 持错误同步码 (即错误密钥) 解密必须 reject, 而非静默还原
  await assert.rejects(() => decryptJson(wrongKey, iv, ciphertext))
})

test("decryptJson: 篡改 ciphertext / iv 一字符必须解密失败 (GCM 认证标签)", async () => {
  const { key } = await deriveKeys(CODE)
  const { iv, ciphertext } = await encryptJson(key, { a: "hello" })
  const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1)
  await assert.rejects(() => decryptJson(key, iv, flip(ciphertext)), "篡改密文应失败")
  await assert.rejects(() => decryptJson(key, flip(iv), ciphertext), "篡改 IV 应失败")
})

test("encryptJson: 同明文两次加密的 IV 必须不同 (nonce 唯一性)", async () => {
  const { key } = await deriveKeys(CODE)
  const a = await encryptJson(key, { same: "payload" })
  const b = await encryptJson(key, { same: "payload" })
  // AES-GCM 在相同 key 下复用 nonce 会灾难性泄密, 故每次必须新随机 IV
  assert.notEqual(a.iv, b.iv)
  assert.notEqual(a.ciphertext, b.ciphertext)
})
