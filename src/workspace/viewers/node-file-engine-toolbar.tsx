"use client"

import * as React from "react"
import { toast } from "sonner"
import { sameFileRef, type IdeallFile } from "@protocol/file-system"
import { invokeFileAction, readFile } from "@/filesystem/registry"
import { resourceRefForFile } from "@/filesystem/resource-file-system"
import { downloadBlob } from "@/lib/browser-download"
import { fileTypeInfo } from "@/lib/format"
import { undoableDeleteToast } from "@/lib/undo-toast"
import { ConfirmDialog, TextPromptDialog } from "@/shared/prompt-dialog"
import { fileMetaActionInput, fileReference, parseFileTags } from "../file-action-utils"
import { fileReadResultToBlob } from "@/filesystem/read-result"
import { fileTags } from "../file-engine-data"
import { closeNodeTabs } from "../store"
import { clearFileDraft } from "./file-draft"
import { fileActionInvokeOptions, isCommittedFileActionVersionSuperseded } from "./file-action-form"
import FileViewerToolbar, { type FileToolbarFile } from "./file-viewer-toolbar"

type Props = {
  file: IdeallFile
  enginePicker: React.ReactNode
  onFileChanged: React.Dispatch<React.SetStateAction<IdeallFile | null>>
  readOnly?: boolean
}

const UI_ACTION_CONTEXT = { actor: "ui", permissions: [], intent: "action" } as const
const UI_CONTENT_CONTEXT = { actor: "ui", permissions: [], intent: "content" } as const

function errorDescription(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function committedVersion(result: unknown): string | undefined {
  if (
    result == null ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    !("meta" in result)
  ) {
    return undefined
  }
  const meta = result.meta
  if (meta == null || typeof meta !== "object" || Array.isArray(meta) || !("updatedAt" in meta)) {
    return undefined
  }
  return typeof meta.updatedAt === "number" && Number.isFinite(meta.updatedAt)
    ? String(meta.updatedAt)
    : undefined
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
  const [renameVersion, setRenameVersion] = React.useState<IdeallFile["version"]>()
  const [tagsVersion, setTagsVersion] = React.useState<IdeallFile["version"]>()
  const [deleteVersion, setDeleteVersion] = React.useState<IdeallFile["version"]>()

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

  const rename = async (nextName: string, expectedVersion: IdeallFile["version"]) => {
    const name = nextName.trim()
    if (!name || name === displayName) return
    try {
      const result = await invokeFileAction(
        file.ref,
        "edit",
        fileMetaActionInput({ name }),
        UI_ACTION_CONTEXT,
        fileActionInvokeOptions(expectedVersion),
      )
      const version = committedVersion(result)
      onFileChanged((current) => {
        if (
          !current ||
          !sameFileRef(current.ref, file.ref) ||
          isCommittedFileActionVersionSuperseded(current.version, version, expectedVersion)
        ) {
          return current
        }
        return { ...current, name, version: version ?? current.version }
      })
      toast.success("已重命名")
    } catch (reason) {
      toast.error("重命名失败", { description: errorDescription(reason) })
    }
  }

  const updateTags = async (input: string, expectedVersion: IdeallFile["version"]) => {
    const tags = parseFileTags(input)
    try {
      const result = await invokeFileAction(
        file.ref,
        "edit",
        fileMetaActionInput({ tags }),
        UI_ACTION_CONTEXT,
        fileActionInvokeOptions(expectedVersion),
      )
      const version = committedVersion(result)
      onFileChanged((current) => {
        if (
          !current ||
          !sameFileRef(current.ref, file.ref) ||
          isCommittedFileActionVersionSuperseded(current.version, version, expectedVersion)
        ) {
          return current
        }
        return {
          ...current,
          version: version ?? current.version,
          properties: { ...current.properties, tags },
        }
      })
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
      downloadBlob(fileReadResultToBlob(result), displayName)
    } catch (reason) {
      toast.error("下载失败", { description: errorDescription(reason) })
    }
  }

  const remove = async (expectedVersion: IdeallFile["version"]) => {
    try {
      await invokeFileAction(
        file.ref,
        "delete",
        undefined,
        UI_ACTION_CONTEXT,
        fileActionInvokeOptions(expectedVersion),
      )
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
        onRename={() => {
          setRenameVersion(file.version)
          setRenameOpen(true)
        }}
        onEditTags={() => {
          setTagsVersion(file.version)
          setTagsOpen(true)
        }}
        onClearTags={() => void updateTags("", file.version)}
        onCopyName={() => void copyText("文件名", displayName || "无标题")}
        onCopyRef={() => void copyText("文件引用", fileReference(fileId))}
        onDiscardDraft={() => {}}
        onDelete={() => {
          setDeleteVersion(file.version)
          setDeleteOpen(true)
        }}
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
        onSubmit={(name) => void rename(name, renameVersion)}
      />
      <TextPromptDialog
        open={tagsOpen}
        onOpenChange={setTagsOpen}
        title="编辑标签"
        label="标签"
        defaultValue={displayTags.join(", ")}
        placeholder="用逗号分隔多个标签"
        confirmLabel="保存"
        onSubmit={(tags) => void updateTags(tags, tagsVersion)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`删除「${displayName}」?`}
        description="删除后可从提示中撤销。"
        confirmLabel="删除"
        destructive
        onConfirm={() => void remove(deleteVersion)}
      />
    </>
  )
}
