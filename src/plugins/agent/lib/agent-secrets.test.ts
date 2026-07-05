// 单元: ${NAME} 占位解析 (密钥表)。
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  AGENT_SECRETS_STORAGE_KEY,
  setSecret,
  deleteSecret,
  resolveSecrets,
  hasSecretRef,
  hydrateAgentSecretsSecure,
  getSecrets,
} from "./agent-secrets"

const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => (mem.has(key) ? mem.get(key)! : null),
  setItem: (key: string, value: string) => void mem.set(key, value),
  removeItem: (key: string) => void mem.delete(key),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage

test("桌面密钥水合不再接受 localStorage 明文密钥值", async () => {
  mem.clear()
  ;(globalThis as unknown as { window?: Window }).window = {
    __TAURI_INTERNALS__: {},
  } as unknown as Window
  mem.set(AGENT_SECRETS_STORAGE_KEY, JSON.stringify([{ id: "TOK", value: "public-secret" }]))

  await hydrateAgentSecretsSecure()

  assert.equal(resolveSecrets("${TOK}"), "${TOK}")
  assert.deepEqual(getSecrets(), [{ id: "TOK", value: "", secure: true }])
  assert.deepEqual(JSON.parse(mem.get(AGENT_SECRETS_STORAGE_KEY) ?? "[]"), [
    { id: "TOK", value: "", secure: true },
  ])
  delete (globalThis as unknown as { window?: Window }).window
})

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
