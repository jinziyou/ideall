// sync 插件 manifest —— 向「我的」注册 SyncPort (跨端同步编排)。
// core 的同步面板经 @protocol/sync 的 getSyncPort() 调用, 不直接依赖本插件。
// 一次 syncNow 同步两个独立加密块: 关注 + 笔记 (各自 storageId, 互不覆盖)。
import { registerSyncPort, type SyncResult } from "@protocol/sync"
import { syncNow as syncSubscriptions } from "./lib/subscription-sync"
import { syncNotes } from "./lib/notes-sync"

export const syncManifest = {
  id: "sync" as const,
  register() {
    registerSyncPort({
      async syncNow(code): Promise<SyncResult> {
        // 并发同步两域; 各自本地优先 (成功侧本地已落地)。任一失败则抛其消息, 让用户得知未全同步。
        const settled = await Promise.allSettled([syncSubscriptions(code), syncNotes(code)])
        const errs = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected")
        if (errs.length) {
          const msg = errs
            .map((e) => (e.reason instanceof Error ? e.reason.message : String(e.reason)))
            .join("；")
          throw new Error(msg)
        }
        const ok = settled as PromiseFulfilledResult<SyncResult>[]
        return ok.reduce(
          (acc, r) => ({ total: acc.total + r.value.total, added: acc.added + r.value.added }),
          { total: 0, added: 0 },
        )
      },
    })
  },
}
