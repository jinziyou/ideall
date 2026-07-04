// Debug 插件 manifest —— 本地运行态诊断面板。
export const debugManifest = {
  id: "debug" as const,
  register() {
    // 无额外端口注册; 视图挂载见 workspace/registry.tsx。
  },
}
