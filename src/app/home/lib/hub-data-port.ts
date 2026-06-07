// core 对 HubDataPort 的实现 —— 包装中枢本地存储 (IndexedDB stores)。
// 经组合根注册到 protocol; agent 等插件经 @protocol/hub-data 的 getHubData() 调用, 不直接依赖这些 store。
import type { HubDataPort } from "@protocol/hub-data"
import { addSubscription, listSubscriptions, removeSubscription } from "./subscriptions-store"
import {
  addBookmark,
  addFolder,
  deleteBookmark,
  listBookmarks,
  listFolders,
  updateBookmark,
} from "./bookmarks-store"
import { listFiles, updateFileMeta } from "./files-store"

export const hubDataPort: HubDataPort = {
  listSubscriptions,
  addSubscription,
  removeSubscription,
  listBookmarks,
  addBookmark,
  updateBookmark,
  deleteBookmark,
  listFolders,
  addFolder,
  listFiles,
  updateFileMeta,
}
