// 单元: ${NAME} 占位解析 (密钥表)。
import { test } from "node:test"
import assert from "node:assert/strict"
import { setSecret, deleteSecret, resolveSecrets, hasSecretRef } from "./agent-secrets"

test("${NAME} 解析: 命中替换, 未知名原样保留 (便于发现拼写错)", () => {
  setSecret("TOK", "Bearer xyz")
  assert.equal(resolveSecrets("${TOK}"), "Bearer xyz")
  assert.equal(resolveSecrets("前 ${TOK} 后"), "前 Bearer xyz 后")
  assert.equal(resolveSecrets("${UNKNOWN}"), "${UNKNOWN}")
  assert.equal(hasSecretRef("${TOK}"), true)
  assert.equal(hasSecretRef("纯文本"), false)
  deleteSecret("TOK")
  assert.equal(resolveSecrets("${TOK}"), "${TOK}")
})
