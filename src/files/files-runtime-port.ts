// Storage + FileSystem 的 core 组合适配器。FilesPort facade 只依赖注入契约；跨记录原子能力
// 在这里绑定到具体 IndexedDB store，避免兼容外观重新绕过 FileSystem 访问普通单文件 CRUD。
import { createFileSystemFilesPort } from "@/files/files-port"
import type { ThreadTaskStoragePort } from "@protocol/files"
import {
  attachThreadTask,
  createTaskThread,
  deleteTaskThread,
  listThreadTasks,
  migrateLegacyThreadTasks,
  readThreadTaskIndexHead,
  replaceThreadTasks,
  updateThreadTask,
} from "@/files/stores/thread-tasks-store"

const threadTasks = {
  readThreadTaskIndexHead,
  listThreadTasks,
  migrateLegacyThreadTasks,
  createTaskThread,
  attachThreadTask,
  updateThreadTask,
  deleteTaskThread,
  replaceThreadTasks,
} satisfies ThreadTaskStoragePort

export const filesPort = createFileSystemFilesPort(undefined, {
  threadTasks,
})
