// sync 插件 manifest —— 向「我的」注册 SyncPort (跨端同步编排)。
// core 的同步面板经 @protocol/sync 的 getSyncPort() 调用, 不直接依赖本插件。
// 一次 syncNow 同步两个独立加密块: 关注 + 笔记 (各自 storageId, 互不覆盖); 编排见 sync-orchestrator-machine (XState)。
import { registerSyncPort } from "@protocol/sync"

export const syncManifest = {
  id: "sync" as const,
  register() {
    registerSyncPort({
      syncNow: async (code) => {
        const { runSyncOrchestrator } = await import("./lib/sync-orchestrator-machine")
        return runSyncOrchestrator(code)
      },
    })
  },
}
