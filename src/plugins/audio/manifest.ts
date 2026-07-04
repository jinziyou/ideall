// 音频播放器插件 manifest —— 本地音频文件播放。
// 视图与路由由 workspace/registry 与 workspace/modules 显式挂载; manifest 目前仅做身份声明。
export const audioManifest = {
  id: "audio" as const,
  register() {
    // 无额外端口注册; 视图挂载见 workspace/registry.tsx。
  },
}
