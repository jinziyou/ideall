"use client"

// 节点查看器: 文件。自取数 (useFilePreview) + 按 mime 分派预览 (FilePreviewBox) + 下载。
// 复用 home/resources/file-preview 的核心 (与预览对话框同一逻辑, 不 fork)。onLoaded 回填标签标题。
import * as React from "react"
import dynamic from "next/dynamic"
import {
  ClipboardCopy,
  Download,
  Eye,
  Loader2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Save,
  Tags,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { fileTypeInfo, formatBytes, formatTime } from "@/lib/format"
import {
  deleteFile,
  restoreFile,
  updateFileContent,
  updateFileMeta,
} from "@/files/stores/files-store"
import { FileTypeBadge, FileTypeIcon } from "@/shared/file-type-icon"
import { ConfirmDialog, TextPromptDialog } from "@/shared/prompt-dialog"
import { undoableDeleteToast } from "@/lib/undo-toast"
import {
  useFilePreview,
  FilePreviewBox,
  downloadStoredFile,
} from "@/modules/home/resources/file-preview"
import { nodeTab } from "../node-tab"
import { closeTab, promoteActiveTab, renameNodeTab, setTabDirty, tabKey } from "../store"
import { useTabActive } from "../tab-active-context"
import { clearFileDraft, readFileDraft, writeFileDraft } from "./file-draft"
import type { NodeViewerProps } from "../node-viewers"

type FileViewerMode = "preview" | "edit"

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
  const tabId = React.useMemo(() => tabKey(nodeTab({ kind: "file", id: nodeId }, "")), [nodeId])
  const [mode, setMode] = React.useState<FileViewerMode>("preview")
  const [draft, setDraft] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [metaOverride, setMetaOverride] = React.useState<{ name?: string; tags?: string[] }>({})
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [tagsOpen, setTagsOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [draftSavedAt, setDraftSavedAt] = React.useState<number | null>(null)
  const restoredDraftRef = React.useRef<string | null>(null)
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
      setDraft("")
      return
    }
    const savedDraft = readFileDraft(file.id)
    if (savedDraft && savedDraft.base === preview.text && savedDraft.draft !== preview.text) {
      setDraft(savedDraft.draft)
      setDraftSavedAt(savedDraft.updatedAt || Date.now())
      setMode("edit")
      if (restoredDraftRef.current !== file.id) {
        restoredDraftRef.current = file.id
        toast.info("已恢复未保存草稿", { description: file.name })
      }
      return
    }
    if (savedDraft && savedDraft.base !== preview.text) clearFileDraft(file.id)
    setDraft(preview.text)
    setDraftSavedAt(null)
  }, [file, preview.text])

  React.useEffect(() => {
    if (!editable && mode === "edit") setMode("preview")
  }, [editable, mode])

  const dirty = editable && preview.text !== null && draft !== preview.text

  React.useEffect(() => {
    setTabDirty(tabId, dirty)
  }, [dirty, tabId])

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

  const handleDraftChange = React.useCallback(
    (next: string) => {
      if (preview.text !== null && next !== preview.text) promoteActiveTab()
      setDraft(next)
    },
    [preview.text],
  )

  const handleSave = React.useCallback(async () => {
    if (!file || !type || !editable || !dirty) return
    setSaving(true)
    try {
      const saved = await updateFileContent(file.id, draft, mimeForSave(type.preview, file.type))
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
  }, [dirty, draft, editable, file, type])

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
    try {
      await updateFileMeta(file.id, { name: nextName })
      setMetaOverride((prev) => ({ ...prev, name: nextName }))
      renameNodeTab({ kind: "file", id: nodeId }, nextName)
      if (!dirty) setRevision((v) => v + 1)
      toast.success("已重命名")
    } catch (e) {
      toast.error("重命名失败", { description: String(e) })
    }
  }

  async function handleTags(nextTagsText: string) {
    if (!file) return
    const tags = nextTagsText
      .split(/[,，\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    try {
      await updateFileMeta(file.id, { tags })
      setMetaOverride((prev) => ({ ...prev, tags }))
      toast.success("已更新标签")
    } catch (e) {
      toast.error("更新标签失败", { description: String(e) })
    }
  }

  async function handleDelete() {
    if (!file) return
    try {
      const captured = { ...file, name: displayName, tags: displayTags }
      await deleteFile(file.id)
      clearFileDraft(file.id)
      undoableDeleteToast(displayName, async () => {
        await restoreFile(captured)
      })
      closeTab(tabId)
    } catch (e) {
      toast.error("删除失败", { description: String(e) })
    }
  }

  function discardDraft() {
    if (!file || preview.text === null) return
    clearFileDraft(file.id)
    setDraft(preview.text)
    setDraftSavedAt(null)
    toast.success("已丢弃草稿")
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制${label}`)
    } catch {
      toast.error("复制失败")
    }
  }

  if (!loading && !file) {
    return <div className="p-6 text-sm text-muted-foreground">该文件不存在或已删除。</div>
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
          {file ? (
            <FileTypeIcon name={displayName} type={file.type} className="h-5 w-5" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold" title={displayName}>
            {displayName || "加载中..."}
          </h1>
          {file && type && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <FileTypeBadge name={displayName} type={file.type} />
              <span>{formatBytes(file.size)}</span>
              <span>{file.type || type.label}</span>
              {dirty && <span className="text-amber-600">未保存</span>}
              {dirty && (
                <span>草稿已暂存{draftSavedAt ? ` · ${formatTime(draftSavedAt)}` : ""}</span>
              )}
              {displayTags.map((tag) => (
                <span key={tag} className="rounded bg-muted px-1.5 py-0.5">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {editable && (
            <div className="inline-flex h-9 items-center rounded-md border border-input bg-background p-0.5">
              <button
                type="button"
                title="预览"
                aria-label="预览"
                onClick={() => setMode("preview")}
                className={cn(
                  "flex h-7 w-8 items-center justify-center rounded text-muted-foreground transition-colors",
                  mode === "preview" && "bg-secondary text-secondary-foreground",
                )}
              >
                <Eye className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="编辑"
                aria-label="编辑"
                onClick={() => setMode("edit")}
                className={cn(
                  "flex h-7 w-8 items-center justify-center rounded text-muted-foreground transition-colors",
                  mode === "edit" && "bg-secondary text-secondary-foreground",
                )}
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          )}
          {editable && (
            <Button variant="outline" size="sm" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              保存
            </Button>
          )}
          {file && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadStoredFile(displayFile ?? file)}
            >
              <Download className="mr-2 h-4 w-4" />
              下载
            </Button>
          )}
          {file && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">文件操作</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTagsOpen(true)}>
                  <Tags className="mr-2 h-4 w-4" />
                  编辑标签
                </DropdownMenuItem>
                {displayTags.length > 0 && (
                  <DropdownMenuItem onClick={() => void handleTags("")}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    清空标签
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => void copyText("文件名", displayName)}>
                  <ClipboardCopy className="mr-2 h-4 w-4" />
                  复制文件名
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void copyText("文件引用", `fs://file/${file.id}`)}>
                  <ClipboardCopy className="mr-2 h-4 w-4" />
                  复制引用
                </DropdownMenuItem>
                {dirty && (
                  <DropdownMenuItem onClick={discardDraft}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    丢弃草稿
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

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
