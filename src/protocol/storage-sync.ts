// 存储级同步端口 —— 只暴露需要保留 tombstone 与原子批处理语义的原始数据面。
//
// 它刻意独立于 FilesPort：普通 agent/embed CRUD 必须经 FileSystem；只有 sync 插件可以
// 在 composition root 注入后使用这一窄端口，避免 bulkPut/含删除标记全量读成为通用文件能力。
import type { Note } from "./files"
import type { NodeOfKind } from "./node"
import type { Subscription } from "./subscription"

/** 书签同步使用统一 Node 形状，收藏夹与书签必须在同一快照内保持父子关系。 */
export type BookmarkSyncNode = NodeOfKind<"bookmark"> | NodeOfKind<"folder">

/** 同步读取快照后本地又发生写入；调用方必须重新读取、合并，不能覆盖新状态。 */
export class StorageSyncConflictError extends Error {
  override readonly name = "StorageSyncConflictError"

  constructor(domain: "关注" | "笔记" | "书签") {
    super(`${domain}在同步期间发生了本地变化，请重试同步`)
  }
}

export interface StorageSyncPort {
  /** 含删除标记的关注全量快照，仅供跨端合并。 */
  listAllSubscriptions(): Promise<Subscription[]>
  /**
   * 仅当本地仍等于 expectedLocal 时原子落地关注快照，并清理已 GC 的删除标记。
   * 当前状态已等于目标时允许幂等成功；返回 Storage 规范化后的实际提交逻辑快照。
   */
  bulkPutSubscriptions(
    subscriptions: Subscription[],
    expectedLocal: Subscription[],
  ): Promise<Subscription[]>
  /** 含删除标记与完整正文的笔记全量快照，仅供跨端合并。 */
  listAllNotes(): Promise<Note[]>
  /**
   * 仅当本地仍等于 expectedLocal 时原子落地笔记快照，并清理已 GC 的删除标记。
   * 当前状态已等于目标时允许幂等成功；返回 Storage 规范化后的实际提交逻辑快照。
   */
  bulkPutNotes(notes: Note[], expectedLocal: Note[]): Promise<Note[]>
  /** 含收藏夹、书签和删除标记的全量快照，仅供跨端合并。 */
  listAllBookmarkNodes(): Promise<BookmarkSyncNode[]>
  /** 以一次事务 CAS 落地收藏夹与书签，避免父子关系只提交一半。 */
  bulkPutBookmarkNodes(
    nodes: BookmarkSyncNode[],
    expectedLocal: BookmarkSyncNode[],
  ): Promise<BookmarkSyncNode[]>
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
