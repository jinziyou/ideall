import type { FileRef } from "@protocol/file-system"

/** ideall 全局路径命名空间的隐藏根。路径只是从该根出发的目录项投影，不参与文件身份。 */
export const IDEALL_ROOT_FILE_SYSTEM_ID = "ideall.root"

export const IDEALL_ROOT_REF: FileRef = {
  fileSystemId: IDEALL_ROOT_FILE_SYSTEM_ID,
  fileId: "root",
}
