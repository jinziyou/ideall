import { BUILTIN_ENGINES, engineRegistry } from "@/engines/builtin"

// Code 插件 manifest —— 本地开发与运行态诊断面板。
export const codeManifest = {
  id: "code" as const,
  engines: ["ideall.code"] as const,
  register() {
    const descriptor = BUILTIN_ENGINES.find((engine) => engine.engineId === "ideall.code")
    return descriptor && !engineRegistry.get(descriptor.engineId)
      ? engineRegistry.register(descriptor)
      : () => {}
  },
}
