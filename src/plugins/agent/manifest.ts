import {
  AGENT_CONFIG_READ_PERMISSION,
  AGENT_CONFIG_WRITE_PERMISSION,
  agentConfigFileSystem,
} from "./agent-config-file-system"
import { agentAuditFileSystem } from "./agent-audit-file-system"
import { agentManagementEngineContributions } from "./agent-management-engines"
import {
  AGENT_DATA_SPEC,
  exportAgentConfigJson,
  inspectAgentConfigData,
} from "./lib/agent-data-port"
import type { PluginDataPort } from "@/plugins/shared/plugin-data"
import { agentLocalDataSchemas } from "./local-data-schemas"
import { importAgentConfigJsonWithFileLocks } from "./agent-settings-write-adapter"

const agentDataPort: PluginDataPort = {
  ...AGENT_DATA_SPEC,
  filenamePrefix: "ideall-agent",
  importMode: "merge",
  importDescription: "导入会写入 AI 智能体配置, 但不会导入 API Key 或密钥值。",
  exportJson: exportAgentConfigJson,
  importJson: importAgentConfigJsonWithFileLocks,
  inspect: async () => {
    const info = await inspectAgentConfigData()
    return {
      pluginId: AGENT_DATA_SPEC.pluginId,
      label: AGENT_DATA_SPEC.pluginLabel,
      dataKind: AGENT_DATA_SPEC.dataKind,
      dataVersion: AGENT_DATA_SPEC.dataVersion,
      status: info.keys > 0 ? "ready" : "empty",
      itemCount: info.keys,
      bytes: info.bytes,
      updatedAt: info.keys ? Date.now() : null,
      detail:
        info.localSensitiveValues > 0
          ? `${info.keys} 组配置 / ${info.localSensitiveValues} 项需清理敏感值`
          : `${info.keys} 组配置`,
    }
  },
}

/** Agent 的公开配置作为 App 文件系统挂载；管理 UI 统一经 FileDocument/FileSystem 消费。 */
export const agentManifest = {
  id: "agent" as const,
  engines: agentManagementEngineContributions.map(
    (contribution) => contribution.descriptor.engineId,
  ),
  engineContributions: agentManagementEngineContributions,
  dataPorts: [agentDataPort] as const,
  localDataSchemas: agentLocalDataSchemas,
  runtimeExtensionFactory: {
    id: "ideall.agent-config",
    label: "AI 智能体配置",
    version: 2,
    source: { kind: "builtin" as const, id: "ideall" },
    digest: "builtin/ideall.agent-config/v2",
    permissionDigest: "builtin/ideall.agent-config/permissions/v1",
    permissions: ["fs:read", AGENT_CONFIG_READ_PERMISSION, AGENT_CONFIG_WRITE_PERMISSION] as const,
    create() {
      return {
        id: "ideall.agent-config",
        label: "AI 智能体配置",
        fileSystems: [
          {
            provider: agentConfigFileSystem,
            mount: {
              entryId: "app.agent-config",
              name: "AI 智能体配置",
              properties: { navigationHidden: true },
            },
          },
          {
            provider: agentAuditFileSystem,
            mount: {
              entryId: "app.agent-write-audit",
              name: "AI 写入审计",
              properties: { navigationHidden: true },
            },
          },
        ],
        engines: agentManagementEngineContributions,
      }
    },
  },
}
