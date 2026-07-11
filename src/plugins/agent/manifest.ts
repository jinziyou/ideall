import { ideallRootFileSystem } from "@/filesystem/builtin"
import { mountFileSystem } from "@/filesystem/composite-root"
import { fileSystemRegistry } from "@/filesystem/registry"
import { registerAgentConfigFileSystem } from "./agent-config-file-system"
import {
  AGENT_DATA_SPEC,
  exportAgentConfigJson,
  importAgentConfigJson,
  inspectAgentConfigData,
} from "./lib/agent-data-port"
import type { PluginDataPort } from "@/plugins/shared/plugin-data"
import { agentLocalDataSchemas } from "./local-data-schemas"

const agentDataPort: PluginDataPort = {
  ...AGENT_DATA_SPEC,
  filenamePrefix: "ideall-agent",
  importMode: "merge",
  importDescription: "导入会写入 AI 智能体配置, 但不会导入 API Key 或密钥值。",
  exportJson: exportAgentConfigJson,
  importJson: importAgentConfigJson,
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

/** Agent 的真实公开配置作为 App 文件系统挂载；现有管理 UI 继续消费同一组 store。 */
export const agentManifest = {
  id: "agent" as const,
  dataPorts: [agentDataPort] as const,
  localDataSchemas: agentLocalDataSchemas,
  register() {
    return registerAgentConfigFileSystem((provider) =>
      mountFileSystem(fileSystemRegistry, ideallRootFileSystem, provider, {
        entryId: "app.agent-config",
        name: "AI 智能体配置",
        properties: { workspaceModes: ["local"] },
      }),
    )
  },
}
