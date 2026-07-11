"use client"

import * as React from "react"
import { toast } from "sonner"
import type { StoredFile } from "@protocol/files"
import { invokeFileAction, statFile } from "@/filesystem/registry"
import { undoableDeleteToast } from "@/lib/undo-toast"
import {
  downloadStoredFile,
  readStoredNodeFile,
  storedNodeFileRef,
} from "@/modules/home/resources/file-preview"
import { closeNodeTabs, renameNodeTab } from "./store"
import { clearFileDraft } from "./viewers/file-draft"
import { fileReference, parseFileTags } from "./file-action-utils"

export { fileReference, parseFileTags } from "./file-action-utils"

export type FileMetaPatch = Partial<Pick<StoredFile, "name" | "tags">>
export type FileActionMetadata = Pick<StoredFile, "id" | "name">

export type FileActionDeps = {
  updateFileMeta: (id: string, patch: FileMetaPatch) => Promise<void>
  getFile: (id: string) => Promise<StoredFile | undefined>
  getFileMetadata: (id: string) => Promise<FileActionMetadata | undefined>
  deleteFile: (id: string) => Promise<void>
  restoreFile: (id: string) => Promise<void>
  renameFileTab: (id: string, name: string) => void
  closeFileTab: (id: string, label: string) => void
  refreshTree: () => void
  clearFileDraft: (id: string) => void
  downloadFile: (file: StoredFile) => void
  writeClipboard: (text: string) => Promise<void>
  showSuccess: (message: string) => void
  showError: (message: string, description?: string) => void
  showUndoDelete: (label: string, restore: () => void | Promise<void>) => void
}

export type UseFileActionsOptions = {
  refreshTree?: boolean
  onRenamed?: (name: string) => void
  onTagsChanged?: (tags: string[]) => void
  onDeleted?: (file: FileActionMetadata) => void
}

export type RemoveFileInput = {
  id: string
  name?: string
  file?: StoredFile | null
  closeTab?: boolean
}

const UI_ACTION_CONTEXT = { actor: "ui", permissions: [], intent: "action" } as const
const UI_METADATA_CONTEXT = { actor: "ui", permissions: [], intent: "metadata" } as const

const realFileActionDeps: FileActionDeps = {
  updateFileMeta: async (id, patch) => {
    await invokeFileAction(
      storedNodeFileRef(id),
      "edit",
      {
        ...(patch.name !== undefined ? { title: patch.name } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      },
      UI_ACTION_CONTEXT,
    )
  },
  getFile: async (id) => (await readStoredNodeFile(id))?.file,
  getFileMetadata: async (id) => {
    const file = await statFile(storedNodeFileRef(id), UI_METADATA_CONTEXT)
    return file ? { id, name: file.name } : undefined
  },
  deleteFile: async (id) => {
    await invokeFileAction(storedNodeFileRef(id), "delete", undefined, UI_ACTION_CONTEXT)
  },
  restoreFile: async (id) => {
    await invokeFileAction(storedNodeFileRef(id), "restore", undefined, UI_ACTION_CONTEXT)
  },
  renameFileTab: (id, name) => renameNodeTab({ kind: "file", id }, name),
  closeFileTab: (id) => closeNodeTabs({ kind: "file", id }),
  // FileSystem watch 驱动真实 UI 刷新；保留注入点仅供兼容 handler 与聚焦测试。
  refreshTree: () => {},
  clearFileDraft,
  downloadFile: downloadStoredFile,
  writeClipboard: (text) => navigator.clipboard.writeText(text),
  showSuccess: (message) => toast.success(message),
  showError: (message, description) => {
    if (description) toast.error(message, { description })
    else toast.error(message)
  },
  showUndoDelete: undoableDeleteToast,
}

export function createFileActionHandlers(
  deps: FileActionDeps,
  { refreshTree = true, onRenamed, onTagsChanged, onDeleted }: UseFileActionsOptions = {},
) {
  const refreshTreeIfNeeded = () => {
    if (refreshTree) deps.refreshTree()
  }

  const rename = async (id: string, nextName: string): Promise<boolean> => {
    const name = nextName.trim()
    if (!name) return false
    try {
      await deps.updateFileMeta(id, { name })
      deps.renameFileTab(id, name)
      refreshTreeIfNeeded()
      onRenamed?.(name)
      deps.showSuccess("已重命名")
      return true
    } catch (e) {
      deps.showError("重命名失败", String(e))
      return false
    }
  }

  const updateTags = async (id: string, tagText: string): Promise<boolean> => {
    const tags = parseFileTags(tagText)
    try {
      await deps.updateFileMeta(id, { tags })
      refreshTreeIfNeeded()
      onTagsChanged?.(tags)
      deps.showSuccess("已更新标签")
      return true
    } catch (e) {
      deps.showError("更新标签失败", String(e))
      return false
    }
  }

  const download = async (target: string | StoredFile): Promise<boolean> => {
    try {
      const file = typeof target === "string" ? await deps.getFile(target) : target
      if (!file) {
        deps.showError("文件不存在或已删除")
        return false
      }
      deps.downloadFile(file)
      return true
    } catch (e) {
      deps.showError("下载失败", String(e))
      return false
    }
  }

  const copyText = async (label: string, text: string): Promise<boolean> => {
    try {
      await deps.writeClipboard(text)
      deps.showSuccess(`已复制${label}`)
      return true
    } catch {
      deps.showError("复制失败")
      return false
    }
  }

  const copyName = (name: string) => copyText("文件名", name || "无标题")

  const copyRef = (id: string) => copyText("文件引用", fileReference(id))

  const remove = async ({
    id,
    name,
    file,
    closeTab: shouldCloseTab = true,
  }: RemoveFileInput): Promise<boolean> => {
    try {
      const captured = file ?? (await deps.getFileMetadata(id))
      if (!captured) {
        deps.showError("文件不存在或已删除")
        return false
      }
      const label = name || captured.name || "无标题"
      await deps.deleteFile(id)
      deps.clearFileDraft(id)
      if (shouldCloseTab) deps.closeFileTab(id, label)
      refreshTreeIfNeeded()
      deps.showUndoDelete(label, async () => {
        await deps.restoreFile(id)
        refreshTreeIfNeeded()
      })
      onDeleted?.(captured)
      return true
    } catch (e) {
      deps.showError("删除失败", String(e))
      return false
    }
  }

  return {
    rename,
    updateTags,
    download,
    copyText,
    copyName,
    copyRef,
    remove,
  }
}

export function useFileActions({
  refreshTree = true,
  onRenamed,
  onTagsChanged,
  onDeleted,
}: UseFileActionsOptions = {}) {
  return React.useMemo(
    () =>
      createFileActionHandlers(realFileActionDeps, {
        refreshTree,
        onRenamed,
        onTagsChanged,
        onDeleted,
      }),
    [onDeleted, onRenamed, onTagsChanged, refreshTree],
  )
}
