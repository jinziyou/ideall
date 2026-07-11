// 存储级同步端口 —— 只暴露需要保留 tombstone 与原子批处理语义的原始数据面。
//
// 它刻意独立于 FilesPort：普通 agent/embed CRUD 必须经 FileSystem；只有 sync 插件可以
// 在 composition root 注入后使用这一窄端口，避免 bulkPut/含删除标记全量读成为通用文件能力。
import type { Note } from "./files"
import type { Subscription } from "./subscription"

export interface StorageSyncPort {
  /** 含删除标记的关注全量快照，仅供跨端合并。 */
  listAllSubscriptions(): Promise<Subscription[]>
  /** 原子落地合并后的关注快照，并清理已 GC 的删除标记。 */
  bulkPutSubscriptions(subscriptions: Subscription[]): Promise<void>
  /** 含删除标记与完整正文的笔记全量快照，仅供跨端合并。 */
  listAllNotes(): Promise<Note[]>
  /** 原子落地合并后的笔记快照，并清理已 GC 的删除标记。 */
  bulkPutNotes(notes: Note[]): Promise<void>
}

let port: StorageSyncPort | null = null

/** composition root 注册 core 拥有的同步存储实现。 */
export function registerStorageSyncPort(next: StorageSyncPort): () => void {
  const previous = port
  port = next
  return () => {
    if (port === next) port = previous
  }
}

/** sync 插件取存储级同步能力；普通功能不应依赖此端口。 */
export function getStorageSyncPort(): StorageSyncPort {
  if (!port) throw new Error("StorageSyncPort 未注册 (BootGate 未挂载?)")
  return port
}
