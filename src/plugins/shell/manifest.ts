// Shell 插件 manifest —— 本地终端, 用户手动执行系统命令。
// 视图与路由由 workspace/registry 与 workspace/modules 显式挂载; manifest 目前仅做身份声明,
// 后续可扩展为插件注册端口。
export const shellManifest = {
  id: "shell" as const,
  register() {
    // 无额外端口注册; 视图挂载见 workspace/registry.tsx。
  },
}
