"use client"

import * as React from "react"
import { toast } from "sonner"
import type { IdeallFile } from "@protocol/file-system"
import { invokeFileAction, readFile } from "@/filesystem/registry"
import { resourceRefForFile } from "@/filesystem/resource-file-system"
import { fileTypeInfo } from "@/lib/format"
import { undoableDeleteToast } from "@/lib/undo-toast"
import { ConfirmDialog, TextPromptDialog } from "@/shared/prompt-dialog"
import { fileMetaActionInput, fileReference, parseFileTags } from "../file-action-utils"
import { fileReadResultToBlob, fileTags } from "../file-engine-data"
import { closeNodeTabs, renameNodeTab } from "../store"
import { clearFileDraft } from "./file-draft"
import FileViewerToolbar, { type FileToolbarFile } from "./file-viewer-toolbar"

type Props = {
  file: IdeallFile
  enginePicker: React.ReactNode
  onFileChanged: (file: IdeallFile) => void
  readOnly?: boolean
}

const UI_ACTION_CONTEXT = { actor: "ui", permissions: [], intent: "action" } as const
const UI_CONTENT_CONTEXT = { actor: "ui", permissions: [], intent: "content" } as const

function errorDescription(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** File-engine path for local Node files; all persisted data and actions go through FileSystem. */
export default function NodeFileEngineToolbar({
  file,
  enginePicker,
  onFileChanged,
  readOnly = false,
}: Props) {
  const resource = resourceRefForFile(file.ref)
  const fileId = resource?.scheme === "node" && resource.kind === "file" ? resource.id : undefined
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [tagsOpen, setTagsOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  if (!fileId) return null

  const displayName = file.name
  const displayTags = fileTags(file)
  const type = fileTypeInfo(displayName, file.mediaType)
  const toolbarFile: FileToolbarFile = {
    id: fileId,
    name: displayName,
    type: file.mediaType,
    size: file.size ?? 0,
  }

  const rename = async (nextName: string) => {
    const name = nextName.trim()
    if (!name || name === displayName) return
    try {
      await invokeFileAction(file.ref, "edit", fileMetaActionInput({ name }), UI_ACTION_CONTEXT)
      renameNodeTab({ kind: "file", id: fileId }, name)
      onFileChanged({ ...file, name })
      toast.success("已重命名")
    } catch (reason) {
      toast.error("重命名失败", { description: errorDescription(reason) })
    }
  }

  const updateTags = async (input: string) => {
    const tags = parseFileTags(input)
    try {
      await invokeFileAction(file.ref, "edit", fileMetaActionInput({ tags }), UI_ACTION_CONTEXT)
      onFileChanged({ ...file, properties: { ...file.properties, tags } })
      toast.success("已更新标签")
    } catch (reason) {
      toast.error("更新标签失败", { description: errorDescription(reason) })
    }
  }

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`已复制${label}`)
    } catch {
      toast.error("复制失败")
    }
  }

  const download = async () => {
    try {
      const result = await readFile(file.ref, UI_CONTENT_CONTEXT, { encoding: "binary" })
      downloadBlob(displayName, fileReadResultToBlob(result))
    } catch (reason) {
      toast.error("下载失败", { description: errorDescription(reason) })
    }
  }

  const remove = async () => {
    try {
      await invokeFileAction(file.ref, "delete", undefined, UI_ACTION_CONTEXT)
      clearFileDraft(fileId)
      closeNodeTabs({ kind: "file", id: fileId })
      undoableDeleteToast(displayName, async () => {
        await invokeFileAction(file.ref, "restore", undefined, UI_ACTION_CONTEXT)
      })
    } catch (reason) {
      toast.error("删除失败", { description: errorDescription(reason) })
    }
  }

  return (
    <>
      <FileViewerToolbar
        file={toolbarFile}
        displayFile={toolbarFile}
        displayName={displayName}
        displayTags={displayTags}
        type={type}
        editable={false}
        mode="preview"
        dirty={false}
        saving={false}
        draftSavedAt={null}
        onModeChange={() => {}}
        onSave={() => {}}
        onDownload={() => void download()}
        onRename={() => setRenameOpen(true)}
        onEditTags={() => setTagsOpen(true)}
        onClearTags={() => void updateTags("")}
        onCopyName={() => void copyText("文件名", displayName || "无标题")}
        onCopyRef={() => void copyText("文件引用", fileReference(fileId))}
        onDiscardDraft={() => {}}
        onDelete={() => setDeleteOpen(true)}
        extraActions={enginePicker}
        allowMetadataEdit={!readOnly && file.capabilities.includes("write")}
        allowDelete={!readOnly && file.capabilities.includes("delete")}
      />
      <TextPromptDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="重命名文件"
        label="名称"
        defaultValue={displayName}
        onSubmit={(name) => void rename(name)}
      />
      <TextPromptDialog
        open={tagsOpen}
        onOpenChange={setTagsOpen}
        title="编辑标签"
        label="标签"
        defaultValue={displayTags.join(", ")}
        placeholder="用逗号分隔多个标签"
        confirmLabel="保存"
        onSubmit={(tags) => void updateTags(tags)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`删除「${displayName}」?`}
        description="删除后可从提示中撤销。"
        confirmLabel="删除"
        destructive
        onConfirm={() => void remove()}
      />
    </>
  )
}
