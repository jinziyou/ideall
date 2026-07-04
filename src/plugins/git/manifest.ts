// Git 插件 manifest —— 本地仓库工作台。
export const gitManifest = {
  id: "git" as const,
  register() {
    // 无额外端口注册; 视图挂载见 workspace/registry.tsx。
  },
}
