"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Download,
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
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { TextPromptDialog } from "@/shared/prompt-dialog"
import { cn } from "@/lib/utils"
import { FileMeta } from "@protocol/files"
import {
  addFile,
  deleteFile,
  getFile,
  listFiles,
  restoreFile,
  updateFileMeta,
} from "@/files/stores/files-store"
import { undoableDeleteToast } from "@/lib/undo-toast"
import { fileTypeInfo, formatBytes, formatTime } from "@/lib/format"
import { FileTypeBadge, FileTypeIcon } from "@/shared/file-type-icon"
import FilePreviewDialog from "./file-preview-dialog"
import { useIncrementalList } from "@/lib/use-incremental-list"
import { EmptyState } from "@/ui/empty-state"

// 类型筛选分组: 把细分 FileKind 归并为用户可理解的几类
type TypeFilter = "all" | "image" | "code" | "doc" | "data" | "media" | "archive" | "other"

const TYPE_TABS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "image", label: "图片" },
  { value: "code", label: "代码" },
  { value: "doc", label: "文档" },
  { value: "data", label: "数据" },
  { value: "media", label: "媒体" },
  { value: "archive", label: "压缩包" },
  { value: "other", label: "其他" },
]

/** FileTypeInfo.group → 筛选分组 */
function typeGroup(file: FileMeta): Exclude<TypeFilter, "all"> {
  const group = fileTypeInfo(file.name, file.type).group
  if (group === "media") return "media"
  if (group === "document") return "doc"
  if (group === "binary") return "other"
  return group
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
  // 延后释放: a.click() 触发的下载是异步发起的, 部分引擎 (WebKitGTK/Firefox) 若同步 revoke
  // 会拿不到 blob 导致下载失败/空文件。本项目经 Tauri webview 分发 (Linux=WebKitGTK), 风险真实。
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 图片缩略图: 仅在缩略图滚入视口后才读取自身 Blob 并建 ObjectURL, 卸载时释放。
 * 懒加载避免列表里所有图片文件在挂载即一次性 getFile + createObjectURL (本地优先场景可达上千个)。
 */
function Thumbnail({ id }: { id: string }) {
  const [src, setSrc] = React.useState<string | null>(null)
  const [visible, setVisible] = React.useState(false)
  const placeholderRef = React.useRef<HTMLDivElement | null>(null)

  // 滚入视口 (提前 200px) 才标记可见; 命中后即停止观察。
  React.useEffect(() => {
    if (visible) return
    const el = placeholderRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: "200px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  React.useEffect(() => {
    if (!visible) return
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
  }, [id, visible])

  if (!src)
    return (
      <div ref={placeholderRef} className="flex h-full w-full items-center justify-center">
        <ImageIcon className="h-8 w-8 text-muted-foreground" />
      </div>
    )
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
  // 重命名对话框状态 (替代 window.prompt): 以目标文件对象控制 open
  const [renameTarget, setRenameTarget] = React.useState<FileMeta | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const refresh = React.useCallback(async () => {
    try {
      setFiles(await listFiles())
    } catch (e) {
      toast.error("读取文件失败", { description: String(e) })
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
        toast.error("读取文件失败", { description: String(e) })
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
      let failed = 0
      let lastError = ""
      try {
        // 逐个落库各自兜底: 中途某个失败 (如 IndexedDB 配额耗尽) 不丢弃已成功的, 也不跳过刷新
        for (const f of arr) {
          try {
            await addFile(f)
            ok++
          } catch (e) {
            failed++
            lastError = e instanceof Error ? e.message : String(e)
          }
        }
        await refresh()
      } finally {
        setUploading(false)
      }
      // 分级回执: 全成功 / 部分失败 / 全失败
      if (ok && failed) {
        toast.warning(`已添加 ${ok} 个，${failed} 个失败（可能是本机存储已满）`, {
          description: lastError,
        })
      } else if (failed) {
        toast.error("保存文件失败", { description: lastError })
      } else {
        toast.success(`已添加 ${ok} 个文件`)
      }
    },
    [refresh],
  )

  async function handleDelete(file: FileMeta) {
    try {
      // 列表只有元数据, 先取完整文件 (含 Blob) 供撤销原样写回
      const full = await getFile(file.id)
      await deleteFile(file.id)
      setFiles((prev) => prev.filter((f) => f.id !== file.id))
      if (full) {
        undoableDeleteToast(file.name, async () => {
          await restoreFile(full)
          setFiles((prev) =>
            [file, ...prev.filter((f) => f.id !== file.id)].sort(
              (a, b) => b.createdAt - a.createdAt,
            ),
          )
        })
      } else {
        toast.success("已删除", { description: file.name })
      }
    } catch (e) {
      toast.error("删除失败", { description: String(e) })
    }
  }

  async function handleRename(file: FileMeta, name: string) {
    if (name === file.name) return
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
      code: 0,
      doc: 0,
      data: 0,
      media: 0,
      archive: 0,
      other: 0,
    }
    for (const f of files) {
      size += f.size
      byGroup[typeGroup(f)]++
    }
    return { size, byGroup }
  }, [files])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter((f) => {
      if (typeFilter !== "all" && typeGroup(f) !== typeFilter) return false
      if (!q) return true
      return f.name.toLowerCase().includes(q) || f.tags.some((t) => t.toLowerCase().includes(q))
    })
  }, [files, query, typeFilter])

  // 增量渲染: 首屏 N 个, 滚到底自动加载更多; 切搜索/类型即回第一页。
  const { visible, hasMore, sentinelRef, shown, total } = useIncrementalList(filtered, {
    resetKey: `${query}|${typeFilter}`,
  })

  return (
    <div className="flex flex-col gap-4">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="全部文件" value={String(files.length)} />
        <StatCard label="占用空间" value={formatBytes(stats.size)} />
        <StatCard label="图片" value={String(stats.byGroup.image)} />
        <StatCard label="代码/文档" value={String(stats.byGroup.code + stats.byGroup.doc)} />
      </div>

      {/* 上传区 (拖拽 + 点击 + 键盘) */}
      <div
        role="button"
        tabIndex={0}
        aria-label="上传文件：拖拽到此处，或按 Enter / 空格选择文件"
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
        onKeyDown={(e) => {
          // 纯键盘 / 读屏用户: Enter / 空格触发选择文件 (拖拽对键盘不可用)。
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
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
          {uploading ? "正在保存…" : "拖拽文件到此处，或点击选择"}
        </div>
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
              "flex h-7 w-7 items-center justify-center rounded pointer-coarse:h-9 pointer-coarse:w-9",
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
              "flex h-7 w-7 items-center justify-center rounded pointer-coarse:h-9 pointer-coarse:w-9",
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
        <EmptyState
          icon={files.length === 0 ? FileIcon : undefined}
          title={files.length === 0 ? "还没有文件。上传一个试试。" : "没有匹配的文件。"}
        />
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {visible.map((file) => (
            <FileGridCard
              key={file.id}
              file={file}
              onPreview={() => setPreviewId(file.id)}
              onDownload={() => handleDownload(file)}
              onRename={() => setRenameTarget(file)}
              onDelete={() => handleDelete(file)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {visible.map((file, i) => (
            <FileListRow
              key={file.id}
              file={file}
              first={i === 0}
              onPreview={() => setPreviewId(file.id)}
              onDownload={() => handleDownload(file)}
              onRename={() => setRenameTarget(file)}
              onDelete={() => handleDelete(file)}
            />
          ))}
        </div>
      )}

      {!loading && hasMore && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center py-4 text-xs text-muted-foreground"
        >
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          加载更多…（已显示 {shown} / {total}）
        </div>
      )}

      <FilePreviewDialog
        fileId={previewId}
        onOpenChange={(open) => !open && setPreviewId(null)}
        onDownload={(f) => downloadBlob(f.blob, f.name)}
      />
      <TextPromptDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
        title="重命名文件"
        label="名称"
        defaultValue={renameTarget?.name ?? ""}
        onSubmit={(name) => {
          if (renameTarget) handleRename(renameTarget, name)
        }}
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
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 pointer-coarse:h-9 pointer-coarse:w-9"
        >
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
  const type = fileTypeInfo(file.name, file.type)
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground transition-colors hover:border-foreground/20">
      <button
        type="button"
        onClick={actions.onPreview}
        className="flex aspect-video items-center justify-center overflow-hidden bg-muted"
      >
        {type.kind === "image" ? (
          <Thumbnail id={file.id} />
        ) : (
          <FileTypeIcon name={file.name} type={file.type} className="h-10 w-10" />
        )}
      </button>
      <div className="flex items-start gap-1 p-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={file.name}>
            {file.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <FileTypeBadge name={file.name} type={file.type} />
            <span>{formatBytes(file.size)}</span>
            <span>·</span>
            <span>{formatTime(file.createdAt)}</span>
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
  const type = fileTypeInfo(file.name, file.type)
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
        {type.kind === "image" ? (
          <Thumbnail id={file.id} />
        ) : (
          <FileTypeIcon name={file.name} type={file.type} className="h-5 w-5" />
        )}
      </button>
      <button type="button" onClick={actions.onPreview} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-medium" title={file.name}>
          {file.name}
        </div>
        <div className="mt-1 sm:hidden">
          <FileTypeBadge name={file.name} type={file.type} />
        </div>
      </button>
      <div className="hidden shrink-0 sm:block">
        <FileTypeBadge name={file.name} type={file.type} />
      </div>
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
