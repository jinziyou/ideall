// core 对 StorageSyncPort 的实现。这里是少数允许直达 store 的边界：同步必须读取 tombstone
// 并以一次 IndexedDB 事务写回合并结果，无法等价拆成逐文件 CRUD。
import type { StorageSyncPort } from "@protocol/storage-sync"
import { bulkPutSubscriptions, listAllSubscriptions } from "@/files/stores/subscriptions-store"
import { bulkPutNotes, listAllNotes } from "@/files/stores/notes-store"

export const storageSyncPort: StorageSyncPort = {
  listAllSubscriptions,
  bulkPutSubscriptions,
  listAllNotes,
  bulkPutNotes,
}
