// core 对 FilesPort 的实现 —— 包装我的本地存储 (IndexedDB stores)。
// 经组合根注册到 protocol; agent 等插件经 @protocol/files 的 getFilesPort() 调用, 不直接依赖这些 store。
import type { FilesPort } from "@protocol/files"
import {
  addSubscription,
  bulkPutSubscriptions,
  isSubscribed,
  listAllSubscriptions,
  listSubscriptions,
  removeSubscription,
} from "@/files/stores/subscriptions-store"
import {
  addBookmark,
  addFolder,
  deleteBookmark,
  listBookmarks,
  listFolders,
  updateBookmark,
} from "@/files/stores/bookmarks-store"
import { listFiles, updateFileMeta } from "@/files/stores/files-store"
import {
  listNotes,
  getNote,
  listNoteChildren,
  listAllNotes,
  bulkPutNotes,
} from "@/files/stores/notes-store"
import {
  listThreads,
  getThread,
  createThread,
  saveThread,
  deleteThread,
  renameThread,
} from "@/files/stores/threads-store"
import {
  listNodesRaw,
  getNodeRaw,
  createNode,
  updateNode,
  moveNode,
  deleteNode,
  readBlobBase64,
} from "@/files/stores/nodes-store"

export const filesPort: FilesPort = {
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
