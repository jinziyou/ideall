"use client"

import * as React from "react"
import { toast } from "sonner"
import type { StoredFile } from "@protocol/files"
import { deleteFile, getFile, restoreFile, updateFileMeta } from "@/files/stores/files-store"
import { undoableDeleteToast } from "@/lib/undo-toast"
import { downloadStoredFile } from "@/modules/home/resources/file-preview"
import { nodeTab } from "./node-tab"
import { closeTab, renameNodeTab, tabKey } from "./store"
import { refreshSidebarTree } from "./tree/sidebar-tree-bus"
import { clearFileDraft } from "./viewers/file-draft"

type UseFileActionsOptions = {
  refreshTree?: boolean
  onRenamed?: (name: string) => void
  onTagsChanged?: (tags: string[]) => void
  onDeleted?: (file: StoredFile) => void
}

type RemoveFileInput = {
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

export function useFileActions({
  refreshTree = true,
  onRenamed,
  onTagsChanged,
  onDeleted,
}: UseFileActionsOptions = {}) {
  const refreshTreeIfNeeded = React.useCallback(() => {
    if (refreshTree) refreshSidebarTree()
  }, [refreshTree])

  const rename = React.useCallback(
    async (id: string, nextName: string): Promise<boolean> => {
      const name = nextName.trim()
      if (!name) return false
      try {
        await updateFileMeta(id, { name })
        renameNodeTab({ kind: "file", id }, name)
        refreshTreeIfNeeded()
        onRenamed?.(name)
        toast.success("已重命名")
        return true
      } catch (e) {
        toast.error("重命名失败", { description: String(e) })
        return false
      }
    },
    [onRenamed, refreshTreeIfNeeded],
  )

  const updateTags = React.useCallback(
    async (id: string, tagText: string): Promise<boolean> => {
      const tags = parseFileTags(tagText)
      try {
        await updateFileMeta(id, { tags })
        refreshTreeIfNeeded()
        onTagsChanged?.(tags)
        toast.success("已更新标签")
        return true
      } catch (e) {
        toast.error("更新标签失败", { description: String(e) })
        return false
      }
    },
    [onTagsChanged, refreshTreeIfNeeded],
  )

  const download = React.useCallback(async (target: string | StoredFile): Promise<boolean> => {
    try {
      const file = typeof target === "string" ? await getFile(target) : target
      if (!file) {
        toast.error("文件不存在或已删除")
        return false
      }
      downloadStoredFile(file)
      return true
    } catch (e) {
      toast.error("下载失败", { description: String(e) })
      return false
    }
  }, [])

  const copyText = React.useCallback(async (label: string, text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制${label}`)
      return true
    } catch {
      toast.error("复制失败")
      return false
    }
  }, [])

  const copyName = React.useCallback(
    (name: string) => copyText("文件名", name || "无标题"),
    [copyText],
  )

  const copyRef = React.useCallback(
    (id: string) => copyText("文件引用", fileReference(id)),
    [copyText],
  )

  const remove = React.useCallback(
    async ({
      id,
      name,
      file,
      closeTab: shouldCloseTab = true,
    }: RemoveFileInput): Promise<boolean> => {
      try {
        const captured = file ?? (await getFile(id))
        if (!captured) {
          toast.error("文件不存在或已删除")
          return false
        }
        const label = name || captured.name || "无标题"
        await deleteFile(id)
        clearFileDraft(id)
        if (shouldCloseTab) closeTab(tabKey(nodeTab({ kind: "file", id }, label)))
        refreshTreeIfNeeded()
        undoableDeleteToast(label, async () => {
          await restoreFile(captured)
          refreshTreeIfNeeded()
        })
        onDeleted?.(captured)
        return true
      } catch (e) {
        toast.error("删除失败", { description: String(e) })
        return false
      }
    },
    [onDeleted, refreshTreeIfNeeded],
  )

  return React.useMemo(
    () => ({
      rename,
      updateTags,
      download,
      copyText,
      copyName,
      copyRef,
      remove,
    }),
    [copyName, copyRef, copyText, download, remove, rename, updateTags],
  )
}
