import { ideallRootFileSystem } from "@/filesystem/builtin"
import { mountFileSystem } from "@/filesystem/composite-root"
import { fileSystemRegistry } from "@/filesystem/registry"
import { registerAgentConfigFileSystem } from "./agent-config-file-system"

/** Agent 的真实公开配置作为 App 文件系统挂载；现有管理 UI 继续消费同一组 store。 */
export const agentManifest = {
  id: "agent" as const,
  register() {
    registerAgentConfigFileSystem((provider) => {
      mountFileSystem(fileSystemRegistry, ideallRootFileSystem, provider, {
        entryId: "app.agent-config",
        name: "AI 智能体配置",
        properties: { workspaceModes: ["local"] },
      })
    })
  },
}
