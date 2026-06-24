// core 对 HubDataPort 的实现 —— 包装中枢本地存储 (IndexedDB stores)。
// 经组合根注册到 protocol; agent 等插件经 @protocol/hub-data 的 getHubData() 调用, 不直接依赖这些 store。
import type { HubDataPort } from "@protocol/hub-data"
import {
  addSubscription,
  bulkPutSubscriptions,
  isSubscribed,
  listAllSubscriptions,
  listSubscriptions,
  removeSubscription,
} from "./subscriptions-store"
import {
  addBookmark,
  addFolder,
  deleteBookmark,
  listBookmarks,
  listFolders,
  updateBookmark,
} from "./bookmarks-store"
import { listFiles, updateFileMeta } from "./files-store"
import { listNotes, getNote, listNoteChildren, listAllNotes, bulkPutNotes } from "./notes-store"
import {
  listThreads,
  getThread,
  createThread,
  saveThread,
  deleteThread,
  renameThread,
} from "./threads-store"
import {
  listNodesRaw,
  getNodeRaw,
  createNode,
  updateNode,
  moveNode,
  deleteNode,
  readBlobBase64,
} from "./nodes-store"

export const hubDataPort: HubDataPort = {
  listSubscriptions,
  listAllSubscriptions,
  addSubscription,
  removeSubscription,
  isSubscribed,
  bulkPutSubscriptions,
  listBookmarks,
  addBookmark,
  updateBookmark,
  deleteBookmark,
  listFolders,
  addFolder,
  listFiles,
  updateFileMeta,
  listNotes,
  getNote,
  listNoteChildren,
  listAllNotes,
  bulkPutNotes,
  listThreads,
  getThread,
  createThread,
  saveThread,
  deleteThread,
  renameThread,
  fsListNodes: listNodesRaw,
  fsGetNode: getNodeRaw,
  fsCreateNode: createNode,
  fsUpdateNode: updateNode,
  fsMoveNode: moveNode,
  fsDeleteNode: deleteNode,
  fsReadBlob: readBlobBase64,
}
