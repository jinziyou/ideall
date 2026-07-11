import type { FileRef } from "@protocol/file-system"

/**
 * 内置 App 文件系统的稳定根身份。该文件只放协议常量，供 provider、导航和旧快照迁移
 * 共享；不要在这里引入具体存储或 UI 实现。
 */
export const AUDIO_FILE_SYSTEM_ID = "app.audio-library"
export const DATABASE_FILE_SYSTEM_ID = "app.database"
export const GIT_FILE_SYSTEM_ID = "app.git-repositories"

export const AUDIO_LIBRARY_ROOT_REF: FileRef = {
  fileSystemId: AUDIO_FILE_SYSTEM_ID,
  fileId: "root",
}

export const DATABASE_ROOT_REF: FileRef = {
  fileSystemId: DATABASE_FILE_SYSTEM_ID,
  fileId: "root",
}

export const GIT_ROOT_REF: FileRef = {
  fileSystemId: GIT_FILE_SYSTEM_ID,
  fileId: "root",
}
