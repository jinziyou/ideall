"use client"

import type { ReactNode } from "react"
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
import { Button } from "@/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { FileTypeBadge, FileTypeIcon } from "@/shared/file-type-icon"
import { formatBytes, formatTime, type FileTypeInfo } from "@/lib/format"
import type { StoredFile } from "@protocol/files"
import type { FileViewerMode } from "./file-viewer"

type Props = {
  file: StoredFile | null
  displayFile: StoredFile | null
  displayName: string
  displayTags: string[]
  type: FileTypeInfo | null
  editable: boolean
  mode: FileViewerMode
  dirty: boolean
  saving: boolean
  draftSavedAt: number | null
  onModeChange: (mode: FileViewerMode) => void
  onSave: () => void
  onDownload: (file: StoredFile) => void
  onRename: () => void
  onEditTags: () => void
  onClearTags: () => void
  onCopyName: () => void
  onCopyRef: () => void
  onDiscardDraft: () => void
  onDelete: () => void
  extraActions?: ReactNode
}

export default function FileViewerToolbar({
  file,
  displayFile,
  displayName,
  displayTags,
  type,
  editable,
  mode,
  dirty,
  saving,
  draftSavedAt,
  onModeChange,
  onSave,
  onDownload,
  onRename,
  onEditTags,
  onClearTags,
  onCopyName,
  onCopyRef,
  onDiscardDraft,
  onDelete,
  extraActions,
}: Props) {
  const capability = type ? previewCapabilityLabel(type.preview, editable) : null
  return (
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
            {capability && <span>{capability}</span>}
            {dirty && <span className="text-amber-600">未保存</span>}
            {dirty && <span>草稿已暂存{draftSavedAt ? ` · ${formatTime(draftSavedAt)}` : ""}</span>}
            {displayTags.map((tag) => (
              <span key={tag} className="rounded bg-muted px-1.5 py-0.5">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {extraActions}
        {editable && (
          <div className="inline-flex h-9 items-center rounded-md border border-input bg-background p-0.5">
            <button
              type="button"
              title="预览"
              aria-label="预览"
              onClick={() => onModeChange("preview")}
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
              onClick={() => onModeChange("edit")}
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
          <Button variant="outline" size="sm" onClick={onSave} disabled={!dirty || saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            保存
          </Button>
        )}
        {file && (
          <Button variant="outline" size="sm" onClick={() => onDownload(displayFile ?? file)}>
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
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="mr-2 h-4 w-4" />
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEditTags}>
                <Tags className="mr-2 h-4 w-4" />
                编辑标签
              </DropdownMenuItem>
              {displayTags.length > 0 && (
                <DropdownMenuItem onClick={onClearTags}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  清空标签
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onCopyName}>
                <ClipboardCopy className="mr-2 h-4 w-4" />
                复制文件名
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCopyRef}>
                <ClipboardCopy className="mr-2 h-4 w-4" />
                复制引用
              </DropdownMenuItem>
              {dirty && (
                <DropdownMenuItem onClick={onDiscardDraft}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  丢弃草稿
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

function previewCapabilityLabel(preview: FileTypeInfo["preview"], editable: boolean): string {
  if (editable) return "可编辑 / 可预览"
  if (
    ["binary", "archive", "document", "presentation", "spreadsheet", "model", "other"].includes(
      preview,
    )
  ) {
    return "仅下载"
  }
  return "可预览"
}
