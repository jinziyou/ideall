import { test } from "node:test"
import assert from "node:assert/strict"
import {
  AGENT_DATA_SPEC,
  AGENT_EXPORT_KIND,
  AGENT_EXPORT_VERSION,
  createAgentConfigExport,
  parseAgentConfigExport,
} from "./agent-data-port"
import { AGENT_SETTINGS_STORAGE_KEY } from "./agent-settings"
import { AGENT_SECRETS_STORAGE_KEY } from "./agent-secrets"
import { AGENT_WORKSPACES_STORAGE_KEY } from "./agent-workspace"
import { PLUGIN_DATA_PACKAGE_KIND, PLUGIN_DATA_PACKAGE_VERSION } from "@/plugins/shared/plugin-data"

test("parseAgentConfigExport: 移除 API Key / 工作区覆盖 Key / 密钥值", () => {
  const pack = createAgentConfigExport(
    {
      [AGENT_SETTINGS_STORAGE_KEY]: {
        baseURL: "https://api.example.test/v1",
        model: "m",
        apiKey: "sk-secret",
      },
      [AGENT_WORKSPACES_STORAGE_KEY]: {
        workspaces: [
          {
            id: "ws1",
            model: { useGlobal: false, baseURL: "u", model: "m", apiKey: "workspace-secret" },
          },
        ],
        activeId: "ws1",
      },
      [AGENT_SECRETS_STORAGE_KEY]: [{ id: "TOK", value: "Bearer secret" }],
    },
    "now",
  )

  const parsed = parseAgentConfigExport(JSON.stringify(pack))
  assert.equal(parsed.kind, PLUGIN_DATA_PACKAGE_KIND)
  assert.equal(parsed.version, PLUGIN_DATA_PACKAGE_VERSION)
  assert.deepEqual(parsed.plugin, {
    id: AGENT_DATA_SPEC.pluginId,
    label: AGENT_DATA_SPEC.pluginLabel,
    dataKind: AGENT_EXPORT_KIND,
    dataVersion: AGENT_EXPORT_VERSION,
  })
  assert.equal(parsed.exportedAt, "now")
  assert.deepEqual(parsed.payload.values[AGENT_SETTINGS_STORAGE_KEY], {
    baseURL: "https://api.example.test/v1",
    model: "m",
  })
  assert.deepEqual(parsed.payload.values[AGENT_SECRETS_STORAGE_KEY], [
    { id: "TOK", value: "", secure: true },
  ])
  assert.equal(
    JSON.stringify(parsed.payload.values[AGENT_WORKSPACES_STORAGE_KEY]).includes(
      "workspace-secret",
    ),
    false,
  )
  assert.equal(JSON.stringify(parsed).includes("sk-secret"), false)
})
