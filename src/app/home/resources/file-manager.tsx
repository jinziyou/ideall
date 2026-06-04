"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Download,
  FileArchive,
  FileAudio,
  FileText,
  FileVideo,
  File as FileIcon,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { FileMeta } from "../model"
import { addFile, deleteFile, getFile, listFiles, updateFileMeta } from "../lib/files-store"
import { fileKind, FileKind, formatBytes, formatTime } from "../lib/format"
import FilePreviewDialog from "./file-preview-dialog"

const KIND_ICON: Record<FileKind, React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  text: FileText,
  archive: FileArchive,
  other: FileIcon,
}

// 类型筛选分组: 把细分 FileKind 归并为用户可理解的几类
type TypeFilter = "all" | "image" | "doc" | "video" | "other"

const TYPE_TABS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "image", label: "图片" },
  { value: "doc", label: "文档" },
  { value: "video", label: "视频" },
  { value: "other", label: "其他" },
]

/** FileKind → 筛选分组 */
function kindGroup(kind: FileKind): Exclude<TypeFilter, "all"> {
  if (kind === "image") return "image"
  if (kind === "pdf" || kind === "text") return "doc"
  if (kind === "video") return "video"
  return "other"
}

type ViewMode = "grid" | "list"

/** 触发浏览器下载一个 Blob */
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 图片缩略图: 仅在卡片渲染时按需读取自身 Blob, 卸载时释放, 避免一次性加载所有大文件 */
function Thumbnail({ id }: { id: string }) {
  const [src, setSrc] = React.useState<string | null>(null)
  React.useEffect(() => {
    let url: string | null = null
    let active = true
    getFile(id).then((f) => {
      if (!active || !f) return
      url = URL.createObjectURL(f.blob)
      setSrc(url)
    })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [id])
  if (!src) return <ImageIcon className="h-8 w-8 text-muted-foreground" />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="h-full w-full object-cover" />
}

export default function FileManager() {
  const [files, setFiles] = React.useState<FileMeta[]>([])
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState("")
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>("all")
  const [view, setView] = React.useState<ViewMode>("grid")
  const [dragging, setDragging] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [previewId, setPreviewId] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const refresh = React.useCallback(async () => {
    try {
      setFiles(await listFiles())
    } catch (e) {
      toast.error("读取本地文件失败", { description: String(e) })
    } finally {
      setLoading(false)
    }
  }, [])

  // 首次挂载加载: setState 仅发生在 await 之后, 满足 react-hooks 规则
  React.useEffect(() => {
    let active = true
    async function load() {
      try {
        const list = await listFiles()
        if (active) setFiles(list)
      } catch (e) {
        toast.error("读取本地文件失败", { description: String(e) })
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const handleUpload = React.useCallback(
    async (fileList: FileList | File[]) => {
      const arr = Array.from(fileList)
      if (!arr.length) return
      setUploading(true)
      let ok = 0
      try {
        for (const f of arr) {
          await addFile(f)
          ok++
        }
        await refresh()
        toast.success(`已添加 ${ok} 个文件`)
      } catch (e) {
        toast.error("保存文件失败", { description: String(e) })
      } finally {
        setUploading(false)
      }
    },
    [refresh],
  )

  async function handleDelete(file: FileMeta) {
    try {
      await deleteFile(file.id)
      setFiles((prev) => prev.filter((f) => f.id !== file.id))
      toast.success("已删除", { description: file.name })
    } catch (e) {
      toast.error("删除失败", { description: String(e) })
    }
  }

  async function handleRename(file: FileMeta) {
    const name = window.prompt("重命名文件", file.name)?.trim()
    if (!name || name === file.name) return
    try {
      await updateFileMeta(file.id, { name })
      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, name } : f)))
    } catch (e) {
      toast.error("重命名失败", { description: String(e) })
    }
  }

  async function handleDownload(file: FileMeta) {
    try {
      const full = await getFile(file.id)
      if (!full) return
      downloadBlob(full.blob, full.name)
    } catch (e) {
      toast.error("下载失败", { description: String(e) })
    }
  }

  // 统计: 总占用 + 各分组数量
  const stats = React.useMemo(() => {
    let size = 0
    const byGroup: Record<Exclude<TypeFilter, "all">, number> = {
      image: 0,
      doc: 0,
      video: 0,
      other: 0,
    }
    for (const f of files) {
      size += f.size
      byGroup[kindGroup(fileKind(f.name, f.type))]++
    }
    return { size, byGroup }
  }, [files])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter((f) => {
      if (typeFilter !== "all" && kindGroup(fileKind(f.name, f.type)) !== typeFilter) return false
      if (!q) return true
      return f.name.toLowerCase().includes(q) || f.tags.some((t) => t.toLowerCase().includes(q))
    })
  }, [files, query, typeFilter])

  return (
    <div className="flex flex-col gap-4">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="全部文件" value={String(files.length)} />
        <StatCard label="占用空间" value={formatBytes(stats.size)} />
        <StatCard label="图片" value={String(stats.byGroup.image)} />
        <StatCard label="文档" value={String(stats.byGroup.doc)} />
      </div>

      {/* 上传区 (拖拽 + 点击) */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
          dragging
            ? "border-primary bg-accent"
            : "border-input hover:border-primary/50 hover:bg-accent/50",
        )}
      >
        {uploading ? (
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="h-7 w-7 text-muted-foreground" />
        )}
        <div className="text-sm font-medium">
          {uploading ? "正在保存…" : "拖拽文件到此处, 或点击选择"}
        </div>
        <div className="text-xs text-muted-foreground">文件仅保存在本机浏览器 (IndexedDB)</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) handleUpload(e.target.files)
            e.target.value = ""
          }}
        />
      </div>

      {/* 工具栏: 搜索 + 类型筛选 + 视图切换 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索文件名 / 标签"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {TYPE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTypeFilter(t.value)}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                typeFilter === t.value
                  ? "border-input bg-secondary text-secondary-foreground"
                  : "border-input text-muted-foreground hover:bg-accent",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center rounded-md border border-input p-0.5">
          <button
            type="button"
            onClick={() => setView("grid")}
            title="网格视图"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded",
              view === "grid"
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            title="列表视图"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded",
              view === "list"
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          加载中…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          {files.length === 0 ? "还没有文件, 上传一个试试。" : "没有匹配的文件。"}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((file) => (
            <FileGridCard
              key={file.id}
              file={file}
              onPreview={() => setPreviewId(file.id)}
              onDownload={() => handleDownload(file)}
              onRename={() => handleRename(file)}
              onDelete={() => handleDelete(file)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {filtered.map((file, i) => (
            <FileListRow
              key={file.id}
              file={file}
              first={i === 0}
              onPreview={() => setPreviewId(file.id)}
              onDownload={() => handleDownload(file)}
              onRename={() => handleRename(file)}
              onDelete={() => handleDelete(file)}
            />
          ))}
        </div>
      )}

      <FilePreviewDialog
        fileId={previewId}
        onOpenChange={(open) => !open && setPreviewId(null)}
        onDownload={(f) => downloadBlob(f.blob, f.name)}
      />
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-card-foreground">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  )
}

type FileActions = {
  onPreview: () => void
  onDownload: () => void
  onRename: () => void
  onDelete: () => void
}

function FileMenu({ onPreview, onDownload, onRename, onDelete }: FileActions) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">操作</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onPreview}>
          <ImageIcon className="mr-2 h-4 w-4" />
          预览
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDownload}>
          <Download className="mr-2 h-4 w-4" />
          下载
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="mr-2 h-4 w-4" />
          重命名
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FileGridCard({ file, ...actions }: { file: FileMeta } & FileActions) {
  const kind = fileKind(file.name, file.type)
  const Icon = KIND_ICON[kind]
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={actions.onPreview}
        className="flex aspect-video items-center justify-center overflow-hidden bg-muted"
      >
        {kind === "image" ? (
          <Thumbnail id={file.id} />
        ) : (
          <Icon className="h-10 w-10 text-muted-foreground" />
        )}
      </button>
      <div className="flex items-start gap-1 p-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={file.name}>
            {file.name}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {formatBytes(file.size)} · {formatTime(file.createdAt)}
          </div>
        </div>
        <FileMenu {...actions} />
      </div>
    </div>
  )
}

function FileListRow({
  file,
  first,
  ...actions
}: { file: FileMeta; first: boolean } & FileActions) {
  const kind = fileKind(file.name, file.type)
  const Icon = KIND_ICON[kind]
  return (
    <div
      className={cn(
        "flex items-center gap-3 bg-card px-3 py-2 text-card-foreground transition-colors hover:bg-accent/40",
        !first && "border-t",
      )}
    >
      <button
        type="button"
        onClick={actions.onPreview}
        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted"
      >
        {kind === "image" ? (
          <Thumbnail id={file.id} />
        ) : (
          <Icon className="h-5 w-5 text-muted-foreground" />
        )}
      </button>
      <button type="button" onClick={actions.onPreview} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-medium" title={file.name}>
          {file.name}
        </div>
      </button>
      <div className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        {formatBytes(file.size)}
      </div>
      <div className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground md:block">
        {formatTime(file.createdAt)}
      </div>
      <FileMenu {...actions} />
    </div>
  )
}
