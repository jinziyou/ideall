import { BUILTIN_ENGINES, engineRegistry } from "@/engines/builtin"

// Shell 插件 manifest —— 本地终端, 用户手动执行系统命令。
// 视图与路由由 workspace/registry 与 workspace/modules 显式挂载; manifest 目前仅做身份声明,
// 后续可扩展为插件注册端口。
export const shellManifest = {
  id: "shell" as const,
  engines: ["ideall.shell"] as const,
  register() {
    const descriptor = BUILTIN_ENGINES.find((engine) => engine.engineId === "ideall.shell")
    if (descriptor && !engineRegistry.get(descriptor.engineId)) engineRegistry.register(descriptor)
  },
}
