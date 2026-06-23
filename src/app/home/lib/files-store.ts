// 文件本地存储仓库 —— 基于 IndexedDB, 存原始 Blob + 元数据。
import { FileMeta, StoredFile } from "../model"
import { genId } from "@/components/lib/id"
import {
  idbCount,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  idbReadModifyWrite,
  STORE_FILES,
} from "@/components/lib/idb"
import { notifyHubUpdated } from "./flowback"

/** 剥离 Blob, 只回元数据 —— 列表与返回值不带原始内容, 避免把所有大文件整块读入内存。 */
function toMeta(f: StoredFile): FileMeta {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    size: f.size,
    createdAt: f.createdAt,
    tags: f.tags,
  }
}

/** 列出所有文件元数据 (不含 Blob), 按创建时间倒序 */
export async function listFiles(): Promise<FileMeta[]> {
  const files = await idbGetAll<StoredFile>(STORE_FILES)
  return files.map(toMeta).sort((a, b) => b.createdAt - a.createdAt)
}

/** 文件数 —— 走 count(), 不把所有文件 Blob 载入内存 (仅需数量徽标时用)。 */
export async function countFiles(): Promise<number> {
  return idbCount(STORE_FILES)
}

/** 读取单个完整文件 (含 Blob) */
export async function getFile(id: string): Promise<StoredFile | undefined> {
  return idbGet<StoredFile>(STORE_FILES, id)
}

/** 保存一个浏览器 File 对象, 返回元数据 */
export async function addFile(file: File, tags: string[] = []): Promise<FileMeta> {
  const stored: StoredFile = {
    id: genId("f"),
    name: file.name,
    type: file.type,
    size: file.size,
    blob: file,
    createdAt: Date.now(),
    tags,
  }
  await idbPut(STORE_FILES, stored)
  notifyHubUpdated()
  return toMeta(stored)
}

/** 更新文件元数据 (重命名 / 改标签); 不改动 Blob */
export async function updateFileMeta(
  id: string,
  patch: Partial<Pick<StoredFile, "name" | "tags">>,
): Promise<void> {
  // 单事务读-改-写 (旧实现读、写分两事务, 改名与改标签并发时后写覆盖前写); 不改动 Blob。
  await idbReadModifyWrite<StoredFile>(STORE_FILES, id, (current) =>
    current ? { ...current, ...patch } : undefined,
  )
}

export async function deleteFile(id: string): Promise<void> {
  await idbDelete(STORE_FILES, id)
  notifyHubUpdated()
}

/** 撤销删除: 把刚删除的文件 (含 Blob) 原样写回 (保留 id/createdAt, 非新建)。 */
export async function restoreFile(file: StoredFile): Promise<void> {
  await idbPut(STORE_FILES, file)
  notifyHubUpdated()
}
