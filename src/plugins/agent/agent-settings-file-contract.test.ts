import assert from "node:assert/strict"
import { test } from "node:test"
import {
  DEFAULT_AGENT_SETTINGS_DOCUMENT,
  MAX_AGENT_SETTINGS_API_KEY_LENGTH,
  MAX_AGENT_SETTINGS_BASE_URL_LENGTH,
  MAX_AGENT_SETTINGS_MODEL_LENGTH,
  decodeAgentSettingsCredentialStatus,
  decodeAgentSettingsDocument,
  decodeAgentSettingsSetApiKeyInput,
  isAgentSettingsDocumentConfigured,
} from "./agent-settings-file-contract"

test("agent settings file contract: decodes only the complete public document", () => {
  assert.deepEqual(decodeAgentSettingsDocument(DEFAULT_AGENT_SETTINGS_DOCUMENT), {
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    includeHomeContext: true,
    defaultAgentMode: true,
    approvalPolicy: "confirm",
  })
  assert.throws(
    () => decodeAgentSettingsDocument({ ...DEFAULT_AGENT_SETTINGS_DOCUMENT, apiKey: "secret" }),
    /未知字段/,
  )
  assert.throws(
    () => decodeAgentSettingsDocument({ ...DEFAULT_AGENT_SETTINGS_DOCUMENT, model: undefined }),
    /model必须是字符串/,
  )
})

test("agent settings file contract: bounds public strings and rejects ambiguous whitespace", () => {
  assert.throws(
    () =>
      decodeAgentSettingsDocument({
        ...DEFAULT_AGENT_SETTINGS_DOCUMENT,
        baseURL: "x".repeat(MAX_AGENT_SETTINGS_BASE_URL_LENGTH + 1),
      }),
    /不能超过/,
  )
  assert.throws(
    () =>
      decodeAgentSettingsDocument({
        ...DEFAULT_AGENT_SETTINGS_DOCUMENT,
        model: "x".repeat(MAX_AGENT_SETTINGS_MODEL_LENGTH + 1),
      }),
    /不能超过/,
  )
  assert.throws(
    () => decodeAgentSettingsDocument({ ...DEFAULT_AGENT_SETTINGS_DOCUMENT, model: " model " }),
    /首尾空白/,
  )
  assert.throws(
    () => decodeAgentSettingsDocument({ ...DEFAULT_AGENT_SETTINGS_DOCUMENT, model: "bad\nmodel" }),
    /控制字符/,
  )
  assert.equal(
    decodeAgentSettingsDocument({ ...DEFAULT_AGENT_SETTINGS_DOCUMENT, model: "" }).model,
    "",
  )
})

test("agent settings file contract: credential actions expose only bounded inputs and status", () => {
  assert.deepEqual(decodeAgentSettingsSetApiKeyInput({ apiKey: "sk-test" }), {
    apiKey: "sk-test",
  })
  assert.deepEqual(decodeAgentSettingsCredentialStatus({ configured: true }), {
    configured: true,
  })
  for (const input of [
    undefined,
    {},
    { apiKey: "" },
    { apiKey: " key " },
    { apiKey: "bad\nkey" },
    { apiKey: 42 },
    { apiKey: "key", extra: true },
    { apiKey: "x".repeat(MAX_AGENT_SETTINGS_API_KEY_LENGTH + 1) },
  ]) {
    assert.throws(() => decodeAgentSettingsSetApiKeyInput(input))
  }
  assert.throws(() => decodeAgentSettingsCredentialStatus({ configured: true, apiKey: "secret" }))
  assert.throws(() => decodeAgentSettingsCredentialStatus({ configured: "yes" }))
})

test("agent settings file contract: readiness requires public target plus credential status", () => {
  assert.equal(isAgentSettingsDocumentConfigured(DEFAULT_AGENT_SETTINGS_DOCUMENT, true), true)
  assert.equal(isAgentSettingsDocumentConfigured(DEFAULT_AGENT_SETTINGS_DOCUMENT, false), false)
  assert.equal(
    isAgentSettingsDocumentConfigured({ ...DEFAULT_AGENT_SETTINGS_DOCUMENT, model: "" }, true),
    false,
  )
})
