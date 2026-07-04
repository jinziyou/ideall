// 数据库插件 manifest —— 本地 IndexedDB 表工作台。
export const databaseManifest = {
  id: "database" as const,
  register() {
    // 无额外端口注册; 视图挂载见 workspace/registry.tsx。
  },
}
