// sync 插件 manifest —— 向中枢注册 SyncPort (跨端同步编排)。
// core 的同步面板经 @protocol/sync 的 getSyncPort() 调用, 不直接依赖本插件。
import { registerSyncPort } from "@protocol/sync"
import { syncNow } from "./lib/subscription-sync"

export const syncManifest = {
  id: "sync" as const,
  register() {
    registerSyncPort({ syncNow })
  },
}
