"use client"

import * as React from "react"
import type { IdeallFile } from "@protocol/file-system"
import type { StoredFile } from "@protocol/files"
import { onFilesUpdated } from "@protocol/flowback"
import { getFile } from "@/files/stores/files-store"
import { fileTypeInfo } from "@/lib/format"
import { ConfirmDialog, TextPromptDialog } from "@/shared/prompt-dialog"
import { resourceRefForFile } from "@/filesystem/resource-file-system"
import { useFileActions } from "../use-file-actions"
import FileViewerToolbar from "./file-viewer-toolbar"

type Props = {
  file: IdeallFile
  enginePicker: React.ReactNode
  onFileChanged: (file: IdeallFile) => void
}

/**
 * 本地 Node 文件的共享外壳。
 *
 * 内容始终由当前 Engine 通过 FileSystem read/write 处理；名称、标签、下载和删除是文件级
 * 动作，不应随旧 FileViewer 一起消失。当前 Node provider 仍用既有动作适配器完成这些操作，
 * 后续来源可按自己的 capabilities/actions 提供等价菜单。
 */
export default function NodeFileEngineToolbar({ file, enginePicker, onFileChanged }: Props) {
  const resource = resourceRefForFile(file.ref)
  const fileId = resource?.scheme === "node" && resource.kind === "file" ? resource.id : undefined
  const [stored, setStored] = React.useState<StoredFile | null>(null)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [tagsOpen, setTagsOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  React.useEffect(() => {
    if (!fileId) return
    let alive = true
    const load = () => {
      void getFile(fileId).then((next) => {
        if (alive) setStored(next ?? null)
      })
    }
    load()
    const dispose = onFilesUpdated((detail) => {
      if (!detail?.kind || (detail.kind === "file" && (!detail.id || detail.id === fileId))) {
        load()
      }
    })
    return () => {
      alive = false
      dispose()
    }
  }, [fileId])

  const handleRenamed = React.useCallback(
    (name: string) => {
      setStored((current) => (current ? { ...current, name } : current))
      onFileChanged({ ...file, name })
    },
    [file, onFileChanged],
  )
  const handleTagsChanged = React.useCallback(
    (tags: string[]) => {
      setStored((current) => (current ? { ...current, tags } : current))
      onFileChanged({
        ...file,
        properties: { ...file.properties, tags },
      })
    },
    [file, onFileChanged],
  )
  const actions = useFileActions({
    onRenamed: handleRenamed,
    onTagsChanged: handleTagsChanged,
  })

  if (!fileId) return null
  const displayName = stored?.name ?? file.name
  const displayTags = stored?.tags ?? []
  const type = fileTypeInfo(displayName, stored?.type ?? file.mediaType)

  return (
    <>
      <FileViewerToolbar
        file={stored}
        displayFile={stored}
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
        onDownload={(target) => void actions.download(target)}
        onRename={() => setRenameOpen(true)}
        onEditTags={() => setTagsOpen(true)}
        onClearTags={() => void actions.updateTags(fileId, "")}
        onCopyName={() => void actions.copyName(displayName)}
        onCopyRef={() => void actions.copyRef(fileId)}
        onDiscardDraft={() => {}}
        onDelete={() => setDeleteOpen(true)}
        extraActions={enginePicker}
      />
      <TextPromptDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="重命名文件"
        label="名称"
        defaultValue={displayName}
        onSubmit={(name) => void actions.rename(fileId, name)}
      />
      <TextPromptDialog
        open={tagsOpen}
        onOpenChange={setTagsOpen}
        title="编辑标签"
        label="标签"
        defaultValue={displayTags.join(", ")}
        placeholder="用逗号分隔多个标签"
        confirmLabel="保存"
        onSubmit={(tags) => void actions.updateTags(fileId, tags)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`删除「${displayName}」?`}
        description="删除后可从提示中撤销。"
        confirmLabel="删除"
        destructive
        onConfirm={() =>
          void actions.remove({ id: fileId, name: displayName, file: stored, closeTab: true })
        }
      />
    </>
  )
}
