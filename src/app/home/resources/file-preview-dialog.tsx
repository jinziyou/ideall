"use client"

import { Download } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { StoredFile } from "../model"
import { formatBytes } from "@/components/lib/hub-format"
import { FilePreviewBox, useFilePreview } from "./file-preview"

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
        {/* key=fileId 让每次切换文件都重新挂载, 由 useFilePreview 初值起步于 loading */}
        {fileId && <DialogBody key={fileId} fileId={fileId} onDownload={onDownload} />}
      </DialogContent>
    </Dialog>
  )
}

function DialogBody({
  fileId,
  onDownload,
}: {
  fileId: string
  onDownload: (file: StoredFile) => void
}) {
  const preview = useFilePreview(fileId)
  const { file } = preview
  // 文件不存在/已删 (getFile undefined): 给出明确提示, 不在加载框上无限转圈 (与 FileViewer 一致)。
  if (!preview.loading && !file) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>预览</DialogTitle>
        </DialogHeader>
        <div className="p-6 text-sm text-muted-foreground">该文件不存在或已删除。</div>
      </>
    )
  }
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

      <FilePreviewBox {...preview} />

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
