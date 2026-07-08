"use client"

// 节点查看器: 文件。自取数 (useFilePreview) + 按 mime 分派预览 (FilePreviewBox) + 下载。
// 复用 home/resources/file-preview 的核心 (与预览对话框同一逻辑, 不 fork)。onLoaded 回填标签标题。
import * as React from "react"
import dynamic from "next/dynamic"
import { Eye, Loader2, Pencil } from "lucide-react"
import { toast } from "sonner"
import { fileTypeInfo } from "@/lib/format"
import { updateFileContent } from "@/files/stores/files-store"
import { ConfirmDialog, TextPromptDialog } from "@/shared/prompt-dialog"
import { useFilePreview, FilePreviewBox } from "@/modules/home/resources/file-preview"
import { resourceTab } from "../resource-tab"
import { promoteActiveTab, renameNodeTab, setTabDirty, tabKey } from "../store"
import { useTabActive } from "../tab-active-context"
import { useFileActions } from "../use-file-actions"
import { clearFileDraft, readFileDraft, writeFileDraft } from "./file-draft"
import FileViewerToolbar from "./file-viewer-toolbar"
import type { NodeViewerProps } from "../node-kind-ui"

export type FileViewerMode = "preview" | "edit"

const CodeEditor = dynamic(() => import("@/shared/code-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      正在加载编辑器...
    </div>
  ),
})

export default function FileViewer({ nodeId }: NodeViewerProps) {
  const active = useTabActive()
  const [revision, setRevision] = React.useState(0)
  const preview = useFilePreview(nodeId, revision)
  const { file, loading } = preview
  const tabId = React.useMemo(
    () => tabKey(resourceTab({ scheme: "node", kind: "file", id: nodeId })),
    [nodeId],
  )
  const [mode, setMode] = React.useState<FileViewerMode>("preview")
  const [draft, setDraft] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [metaOverride, setMetaOverride] = React.useState<{ name?: string; tags?: string[] }>({})
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [tagsOpen, setTagsOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [draftSavedAt, setDraftSavedAt] = React.useState<number | null>(null)
  const restoredDraftRef = React.useRef<string | null>(null)
  const draftRef = React.useRef("")
  const draftFrameRef = React.useRef<number | null>(null)
  const displayName = metaOverride.name ?? file?.name ?? ""
  const displayTags = metaOverride.tags ?? file?.tags ?? []
  const displayFile = file ? { ...file, name: displayName, tags: displayTags } : null
  const type = file ? fileTypeInfo(displayName, file.type) : null
  const editable = Boolean(
    file && type?.editable && preview.text !== null && !preview.textTruncated,
  )

  React.useEffect(() => {
    if (file) renameNodeTab({ kind: "file", id: nodeId }, displayName || file.name)
  }, [displayName, file, nodeId])

  React.useEffect(() => {
    setRevision(0)
    setMode("preview")
    restoredDraftRef.current = null
    setMetaOverride({})
    setDraftSavedAt(null)
  }, [nodeId])

  React.useEffect(() => {
    if (!file || preview.text === null) {
      draftRef.current = ""
      setDraft("")
      return
    }
    const savedDraft = readFileDraft(file.id)
    if (savedDraft && savedDraft.base === preview.text && savedDraft.draft !== preview.text) {
      draftRef.current = savedDraft.draft
      setDraft(savedDraft.draft)
      setDraftSavedAt(savedDraft.updatedAt || Date.now())
      setMode("edit")
      promoteActiveTab()
      if (restoredDraftRef.current !== file.id) {
        restoredDraftRef.current = file.id
        toast.info("已恢复未保存草稿", { description: file.name })
      }
      return
    }
    if (savedDraft && savedDraft.base !== preview.text) clearFileDraft(file.id)
    draftRef.current = preview.text
    setDraft(preview.text)
    setDraftSavedAt(null)
  }, [file, preview.text])

  React.useEffect(
    () => () => {
      if (draftFrameRef.current !== null) cancelAnimationFrame(draftFrameRef.current)
    },
    [],
  )

  React.useEffect(() => {
    if (!editable && mode === "edit") setMode("preview")
  }, [editable, mode])

  const dirty = editable && preview.text !== null && draft !== preview.text

  React.useEffect(() => {
    setTabDirty(tabId, dirty)
  }, [dirty, tabId])

  const handleFileRenamed = React.useCallback(
    (nextName: string) => {
      setMetaOverride((prev) => ({ ...prev, name: nextName }))
      if (!dirty) setRevision((v) => v + 1)
    },
    [dirty],
  )

  const handleFileTagsChanged = React.useCallback((tags: string[]) => {
    setMetaOverride((prev) => ({ ...prev, tags }))
  }, [])

  const fileActions = useFileActions({
    onRenamed: handleFileRenamed,
    onTagsChanged: handleFileTagsChanged,
  })

  React.useEffect(() => {
    if (!file || !editable || preview.text === null) return
    if (dirty) {
      const now = Date.now()
      writeFileDraft(file.id, {
        base: preview.text,
        draft,
        fileName: displayName,
        updatedAt: now,
      })
      setDraftSavedAt(now)
    } else {
      clearFileDraft(file.id)
      setDraftSavedAt(null)
    }
  }, [dirty, displayName, draft, editable, file, preview.text])

  React.useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])

  const handleModeChange = React.useCallback((next: FileViewerMode) => {
    if (next === "edit") promoteActiveTab()
    setMode(next)
  }, [])

  const handleDraftChange = React.useCallback((next: string) => {
    // CodeMirror 在 update listener 内触发 onChange; 延后一帧进 React state, 保存仍读 ref 中的最新文本。
    draftRef.current = next
    if (draftFrameRef.current !== null) return
    draftFrameRef.current = requestAnimationFrame(() => {
      draftFrameRef.current = null
      setDraft(draftRef.current)
    })
  }, [])

  const handleSave = React.useCallback(async () => {
    const nextDraft = draftRef.current
    if (!file || !type || !editable || preview.text === null || nextDraft === preview.text) return
    setSaving(true)
    try {
      const saved = await updateFileContent(
        file.id,
        nextDraft,
        mimeForSave(type.preview, file.type),
      )
      if (!saved) {
        toast.error("文件不存在或已删除")
        return
      }
      clearFileDraft(file.id)
      setDraftSavedAt(null)
      toast.success("已保存")
      setRevision((v) => v + 1)
    } catch (e) {
      toast.error("保存失败", { description: String(e) })
    } finally {
      setSaving(false)
    }
  }, [editable, file, preview.text, type])

  React.useEffect(() => {
    if (!active || !editable) return
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [active, editable, handleSave])

  async function handleRename(nextName: string) {
    if (!file || nextName === displayName) return
    await fileActions.rename(file.id, nextName)
  }

  async function handleTags(nextTagsText: string) {
    if (!file) return
    await fileActions.updateTags(file.id, nextTagsText)
  }

  async function handleDelete() {
    if (!file) return
    await fileActions.remove({
      id: file.id,
      name: displayName,
      file: displayFile ?? file,
      closeTab: true,
    })
  }

  function discardDraft() {
    if (!file || preview.text === null) return
    clearFileDraft(file.id)
    draftRef.current = preview.text
    setDraft(preview.text)
    setDraftSavedAt(null)
    toast.success("已丢弃草稿")
  }

  if (!loading && !file && !preview.error) {
    return <div className="p-6 text-sm text-muted-foreground">该文件不存在或已删除。</div>
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <FileViewerToolbar
        file={file}
        displayFile={displayFile}
        displayName={displayName}
        displayTags={displayTags}
        type={type}
        editable={editable}
        mode={mode}
        dirty={dirty}
        saving={saving}
        draftSavedAt={draftSavedAt}
        onModeChange={handleModeChange}
        onSave={() => void handleSave()}
        onDownload={(target) => void fileActions.download(target)}
        onRename={() => setRenameOpen(true)}
        onEditTags={() => setTagsOpen(true)}
        onClearTags={() => void handleTags("")}
        onCopyName={() => void fileActions.copyName(displayName)}
        onCopyRef={() => {
          if (file) void fileActions.copyRef(file.id)
        }}
        onDiscardDraft={discardDraft}
        onDelete={() => setDeleteOpen(true)}
      />

      <div className="min-h-0 flex-1">
        {mode === "edit" && editable ? (
          <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-2">
            <div className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
              <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/40 px-3 text-xs text-muted-foreground">
                <Pencil className="h-3.5 w-3.5" />
                <span>{type?.language ?? type?.label ?? "Text"}</span>
                {dirty && <span className="ml-auto text-amber-600">未保存</span>}
              </div>
              <CodeEditor
                value={draft}
                filename={displayName}
                language={type?.language ?? type?.label}
                onChange={handleDraftChange}
                className="min-h-0 flex-1"
              />
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/40 px-3 text-xs text-muted-foreground">
                <Eye className="h-3.5 w-3.5" />
                <span>预览</span>
              </div>
              <div className="min-h-0 flex-1">
                <FilePreviewBox
                  {...preview}
                  file={displayFile}
                  text={draft}
                  textTruncated={false}
                  fill
                />
              </div>
            </div>
          </div>
        ) : (
          <FilePreviewBox {...preview} file={displayFile} fill />
        )}
      </div>

      {file && type?.editable && preview.textTruncated && (
        <div className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
          文件较大，当前仅加载前端安全预览片段；请下载后使用本机编辑器处理完整内容。
        </div>
      )}
      {file && (
        <>
          <TextPromptDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            title="重命名文件"
            label="名称"
            defaultValue={displayName}
            onSubmit={(value) => void handleRename(value)}
          />
          <TextPromptDialog
            open={tagsOpen}
            onOpenChange={setTagsOpen}
            title="编辑标签"
            label="标签"
            defaultValue={displayTags.join(", ")}
            placeholder="用逗号分隔多个标签"
            confirmLabel="保存"
            onSubmit={(value) => void handleTags(value)}
          />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={`删除「${displayName}」?`}
            description={
              dirty ? "该文件有未保存草稿，删除会同时丢弃草稿。" : "删除后可从提示中撤销。"
            }
            confirmLabel="删除"
            destructive
            onConfirm={() => void handleDelete()}
          />
        </>
      )}
    </div>
  )
}

function mimeForSave(preview: string, current: string): string {
  if (current) return current
  if (preview === "json") return "application/json"
  if (preview === "markdown") return "text/markdown"
  if (preview === "csv") return "text/csv"
  if (preview === "svg") return "image/svg+xml"
  return "text/plain"
}
