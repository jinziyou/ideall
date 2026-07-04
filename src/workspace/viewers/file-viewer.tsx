"use client"

// 节点查看器: 文件。自取数 (useFilePreview) + 按 mime 分派预览 (FilePreviewBox) + 下载。
// 复用 home/resources/file-preview 的核心 (与预览对话框同一逻辑, 不 fork)。onLoaded 回填标签标题。
import * as React from "react"
import { Download, Eye, Loader2, Pencil, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/ui/button"
import { Textarea } from "@/ui/textarea"
import { cn } from "@/lib/utils"
import { fileTypeInfo, formatBytes } from "@/lib/format"
import { updateFileContent } from "@/files/stores/files-store"
import { FileTypeBadge, FileTypeIcon } from "@/shared/file-type-icon"
import {
  useFilePreview,
  FilePreviewBox,
  downloadStoredFile,
} from "@/modules/home/resources/file-preview"
import { renameNodeTab } from "../store"
import type { NodeViewerProps } from "../node-viewers"

type FileViewerMode = "preview" | "edit"

export default function FileViewer({ nodeId }: NodeViewerProps) {
  const [revision, setRevision] = React.useState(0)
  const preview = useFilePreview(nodeId, revision)
  const { file, loading } = preview
  const type = file ? fileTypeInfo(file.name, file.type) : null
  const editable = Boolean(
    file && type?.editable && preview.text !== null && !preview.textTruncated,
  )
  const [mode, setMode] = React.useState<FileViewerMode>("preview")
  const [draft, setDraft] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (file) renameNodeTab({ kind: "file", id: nodeId }, file.name)
  }, [file, nodeId])

  React.useEffect(() => {
    setRevision(0)
    setMode("preview")
  }, [nodeId])

  React.useEffect(() => {
    if (preview.text !== null) setDraft(preview.text)
    else setDraft("")
  }, [file?.id, preview.text])

  React.useEffect(() => {
    if (!editable && mode === "edit") setMode("preview")
  }, [editable, mode])

  const dirty = editable && preview.text !== null && draft !== preview.text

  async function handleSave() {
    if (!file || !type || !editable || !dirty) return
    setSaving(true)
    try {
      const saved = await updateFileContent(file.id, draft, mimeForSave(type.preview, file.type))
      if (!saved) {
        toast.error("文件不存在或已删除")
        return
      }
      toast.success("已保存")
      setRevision((v) => v + 1)
    } catch (e) {
      toast.error("保存失败", { description: String(e) })
    } finally {
      setSaving(false)
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
            <FileTypeIcon name={file.name} type={file.type} className="h-5 w-5" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold" title={file?.name}>
            {file?.name ?? "加载中..."}
          </h1>
          {file && type && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <FileTypeBadge name={file.name} type={file.type} />
              <span>{formatBytes(file.size)}</span>
              <span>{file.type || type.label}</span>
              {dirty && <span className="text-amber-600">未保存</span>}
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
            <Button variant="outline" size="sm" onClick={() => downloadStoredFile(file)}>
              <Download className="mr-2 h-4 w-4" />
              下载
            </Button>
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
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="h-full min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-[13px] leading-6 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/40 px-3 text-xs text-muted-foreground">
                <Eye className="h-3.5 w-3.5" />
                <span>预览</span>
              </div>
              <div className="min-h-0 flex-1">
                <FilePreviewBox {...preview} text={draft} textTruncated={false} fill />
              </div>
            </div>
          </div>
        ) : (
          <FilePreviewBox {...preview} fill />
        )}
      </div>

      {file && type?.editable && preview.textTruncated && (
        <div className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
          文件较大，当前仅加载前端安全预览片段；请下载后使用本机编辑器处理完整内容。
        </div>
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
