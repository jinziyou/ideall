"use client"

import * as React from "react"
import { toast } from "sonner"
import type { StoredFile } from "@protocol/files"
import { deleteFile, getFile, restoreFile, updateFileMeta } from "@/files/stores/files-store"
import { undoableDeleteToast } from "@/lib/undo-toast"
import { downloadStoredFile } from "@/modules/home/resources/file-preview"
import { resourceTab } from "./resource-tab"
import { closeTab, renameNodeTab, tabKey } from "./store"
import { refreshSidebarTree } from "./tree/sidebar-tree-bus"
import { clearFileDraft } from "./viewers/file-draft"

type FileMetaPatch = Partial<Pick<StoredFile, "name" | "tags">>

export type FileActionDeps = {
  updateFileMeta: (id: string, patch: FileMetaPatch) => Promise<void>
  getFile: (id: string) => Promise<StoredFile | undefined>
  deleteFile: (id: string) => Promise<void>
  restoreFile: (file: StoredFile) => Promise<void>
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
  onDeleted?: (file: StoredFile) => void
}

export type RemoveFileInput = {
  id: string
  name?: string
  file?: StoredFile | null
  closeTab?: boolean
}

export function parseFileTags(input: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of input.split(/[,，\n]/)) {
    const tag = raw.trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

export function fileReference(id: string): string {
  return `fs://file/${id}`
}

const realFileActionDeps: FileActionDeps = {
  updateFileMeta,
  getFile,
  deleteFile,
  restoreFile,
  renameFileTab: (id, name) => renameNodeTab({ kind: "file", id }, name),
  closeFileTab: (id, label) =>
    closeTab(tabKey(resourceTab({ scheme: "node", kind: "file", id }, label))),
  refreshTree: refreshSidebarTree,
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
      const captured = file ?? (await deps.getFile(id))
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
        await deps.restoreFile(captured)
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
