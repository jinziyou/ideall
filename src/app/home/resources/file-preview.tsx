"use client"

// 文件预览核心 (加载 + 按 mime 分派渲染) —— 供预览对话框 (file-preview-dialog, 模态) 与
// 文件查看器 (workspace/viewers/file-viewer, 标签) 共用, 不 fork 预览逻辑。
import * as React from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/components/lib/utils"
import { StoredFile } from "../model"
import { getFile } from "../lib/files-store"
import { fileKind } from "@/components/lib/hub-format"

export const TEXT_PREVIEW_LIMIT = 200 * 1024

export type FilePreviewState = {
  file: StoredFile | null
  url: string | null
  text: string | null
  loading: boolean
}

/**
 * 加载文件 + (文本类) 截断预览; 自动 createObjectURL / 卸载时 revoke。
 * key=fileId 重挂时由 useState 初值起步于 loading (调用方对切换文件用 key 重挂)。
 */
export function useFilePreview(fileId: string): FilePreviewState {
  const [file, setFile] = React.useState<StoredFile | null>(null)
  const [url, setUrl] = React.useState<string | null>(null)
  const [text, setText] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    getFile(fileId)
      .then(async (f) => {
        if (!f) {
          if (active) setLoading(false)
          return
        }
        objectUrl = URL.createObjectURL(f.blob)
        let preview: string | null = null
        if (fileKind(f.name, f.type) === "text") {
          preview = await f.blob.slice(0, TEXT_PREVIEW_LIMIT).text()
        }
        if (!active) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        setFile(f)
        setUrl(objectUrl)
        setText(preview)
        setLoading(false)
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileId])

  return { file, url, text, loading }
}

/** 预览框 (按 mime 分派)；不含标题/下载, 供模态与标签复用。fill=true 时填满父高 (标签场景)。 */
export function FilePreviewBox({
  file,
  url,
  text,
  loading,
  fill = false,
}: FilePreviewState & { fill?: boolean }) {
  const kind = file ? fileKind(file.name, file.type) : "other"
  const maxH = fill ? "max-h-full" : "max-h-[60vh]"
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-auto rounded-md bg-muted",
        fill ? "h-full" : "max-h-[60vh] min-h-[160px]",
      )}
    >
      {loading || !file || !url ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className={cn(maxH, "max-w-full object-contain")} />
      ) : kind === "video" ? (
        <video src={url} controls className={cn(maxH, "w-full")} />
      ) : kind === "audio" ? (
        <audio src={url} controls className="w-full p-4" />
      ) : kind === "pdf" ? (
        // sandbox (无 allow-scripts/allow-same-origin): blob: 与 app 文档同源, 不沙箱则一个 MIME 实为
        // text/html 却名为 .pdf 的文件会以 ideall origin 执行脚本、读 localStorage。
        <iframe src={url} title={file.name} sandbox="" className={cn(fill ? "h-full" : "h-[60vh]", "w-full")} />
      ) : kind === "text" ? (
        <pre className="w-full whitespace-pre-wrap break-words p-4 text-left text-xs">
          {text}
          {text !== null && file.size > TEXT_PREVIEW_LIMIT && (
            <span className="text-muted-foreground">{"\n… (仅预览前 200KB)"}</span>
          )}
        </pre>
      ) : (
        <div className="p-8 text-center text-sm text-muted-foreground">
          该类型暂不支持预览，请下载后查看。
        </div>
      )}
    </div>
  )
}

/** 触发浏览器下载 (沿用 file-manager 的延后 revoke, 避部分引擎同步 revoke 致下载中断)。 */
export function downloadStoredFile(file: StoredFile): void {
  const url = URL.createObjectURL(file.blob)
  const a = document.createElement("a")
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
