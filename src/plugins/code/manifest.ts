// Code 插件 manifest —— 本地开发与运行态诊断面板。
export const codeManifest = {
  id: "code" as const,
  register() {
    // 无额外端口注册; 视图挂载见 workspace/registry.tsx。
  },
}
