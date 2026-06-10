"use client"

import * as React from "react"
import { Download, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { StoredFile } from "../model"
import { getFile } from "../lib/files-store"
import { fileKind, formatBytes } from "@/components/lib/hub-format"

export default function FilePreviewDialog({
  fileId,
  onOpenChange,
  onDownload,
}: {
  fileId: string | null
  onOpenChange: (open: boolean) => void
  onDownload: (file: StoredFile) => void
}) {
  return (
    <Dialog open={!!fileId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        {/* key=fileId 让每次切换文件都重新挂载, 由 useState 初始值起步于 loading */}
        {fileId && <PreviewBody key={fileId} fileId={fileId} onDownload={onDownload} />}
      </DialogContent>
    </Dialog>
  )
}

const TEXT_PREVIEW_LIMIT = 200 * 1024

function PreviewBody({
  fileId,
  onDownload,
}: {
  fileId: string
  onDownload: (file: StoredFile) => void
}) {
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
          // 文本最多预览 200KB, 避免超大文件卡死
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

  const kind = file ? fileKind(file.name, file.type) : "other"

  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate pr-8">{file?.name ?? "预览"}</DialogTitle>
        {file && (
          <DialogDescription>
            {file.type || "未知类型"} · {formatBytes(file.size)}
          </DialogDescription>
        )}
      </DialogHeader>

      <div className="flex max-h-[60vh] min-h-[160px] items-center justify-center overflow-auto rounded-md bg-muted">
        {loading || !file || !url ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={file.name} className="max-h-[60vh] max-w-full object-contain" />
        ) : kind === "video" ? (
          <video src={url} controls className="max-h-[60vh] w-full" />
        ) : kind === "audio" ? (
          <audio src={url} controls className="w-full p-4" />
        ) : kind === "pdf" ? (
          <iframe src={url} title={file.name} className="h-[60vh] w-full" />
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

      {file && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onDownload(file)}>
            <Download className="mr-2 h-4 w-4" />
            下载
          </Button>
        </div>
      )}
    </>
  )
}
