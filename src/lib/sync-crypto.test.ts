// 跨端同步密码学纯函数测试 (Node 内建 WebCrypto, 零浏览器/jsdom)。
// 锁定端到端加密的关键接口约定: 派生确定性 + 规范化 + 加解密往返。
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  deriveKeys,
  decryptBytes,
  encryptJson,
  encryptBytes,
  decryptJson,
  isValidSyncCode,
  generateSyncCode,
  isValidSyncPartition,
} from "./sync-crypto"

const CODE = "1234567890abcdef1234567890abcdef" // 32 hex = 16 字节

test("isValidSyncCode: 32 hex 合法, 短码非法, 生成码合法", () => {
  assert.equal(isValidSyncCode(CODE), true)
  assert.equal(isValidSyncCode("12345678-90abcdef"), false) // 太短
  assert.equal(isValidSyncCode(generateSyncCode()), true) // 生成码含 - 也合法
})

test("deriveKeys: 同码(含分隔符/大小写规范化)派生同 storageId, 长度 32 hex", async () => {
  const a = await deriveKeys(CODE)
  const withDashes = await deriveKeys("12345678-90abcdef-12345678-90abcdef")
  const upper = await deriveKeys(CODE.toUpperCase())
  assert.equal(a.storageId.length, 32) // 128 bit → 32 hex
  assert.equal(withDashes.storageId, a.storageId) // 规范化确定性
  assert.equal(upper.storageId, a.storageId)
  // 不同码派生不同 storageId
  const other = await deriveKeys("ffffffffffffffffffffffffffffffff")
  assert.notEqual(other.storageId, a.storageId)
})

test("deriveKeys: notes 与 bookmarks 使用彼此独立且区别于关注的加密域", async () => {
  const subscriptions = await deriveKeys(CODE)
  const notes = await deriveKeys(CODE, "notes")
  const bookmarks = await deriveKeys(CODE, "bookmarks")
  assert.notEqual(notes.storageId, subscriptions.storageId)
  assert.notEqual(bookmarks.storageId, subscriptions.storageId)
  assert.notEqual(bookmarks.storageId, notes.storageId)
})

test("deriveKeys: partition 0 固定历史 storageId，非零分片稳定隔离", async () => {
  assert.equal((await deriveKeys(CODE, "subs", 0)).storageId, "75a52b96c853c64a6b7b4ec05a746f75")
  assert.equal((await deriveKeys(CODE, "notes", 0)).storageId, "24fec3f048b3d9fae5fef9b958083a14")
  assert.equal(
    (await deriveKeys(CODE, "bookmarks", 0)).storageId,
    "9efcc4f5f21da54a375dae7af8702f0f",
  )
  assert.notEqual(
    (await deriveKeys(CODE, "notes", 1)).storageId,
    (await deriveKeys(CODE, "notes", 0)).storageId,
  )
  assert.equal(isValidSyncPartition(1_023), true)
  assert.equal(isValidSyncPartition(1_024), false)
  await assert.rejects(deriveKeys(CODE, "notes", -1), /同步分片编号无效/)
})

test("encryptJson/decryptJson: 往返还原明文, 密文不含明文", async () => {
  const { key } = await deriveKeys(CODE)
  const value = { subs: [{ id: "1", title: "测试关注标题" }], n: 42 }
  const { iv, ciphertext } = await encryptJson(key, value)
  const back = await decryptJson<typeof value>(key, iv, ciphertext)
  assert.deepEqual(back, value)
  // 密文不应直接暴露明文
  assert.ok(!ciphertext.includes("测试关注标题"))
})

test("encryptBytes/decryptBytes: V2 分片按原始字节往返并守密文上限", async () => {
  const { key } = await deriveKeys(CODE, "notes", 1)
  const plaintext = new TextEncoder().encode("跨分片 JSON 🚀")
  const encrypted = await encryptBytes(key, plaintext, 1_024)
  assert.deepEqual(await decryptBytes(key, encrypted.iv, encrypted.ciphertext, 1_024), plaintext)
  await assert.rejects(encryptBytes(key, plaintext, 20), /传输上限/)
  await assert.rejects(
    decryptBytes(key, encrypted.iv, encrypted.ciphertext, encrypted.ciphertext.length - 4),
    /格式无效或超过上限/,
  )
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

test("encryptJson/decryptJson: 在分配和解析前执行同步块预算", async () => {
  const { key } = await deriveKeys(CODE)
  const budget = {
    maxRecords: 1,
    maxPlaintextBytes: 16,
    maxCiphertextBase64Chars: 44,
  }
  await assert.rejects(encryptJson(key, { value: "payload too large" }, budget), /单块上限/)
  await assert.rejects(
    decryptJson(key, "AAAAAAAAAAAAAAAA", "A".repeat(48), budget),
    /格式无效或超过单块上限/,
  )
})
