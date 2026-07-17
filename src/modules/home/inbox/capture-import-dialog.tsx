"use client"

import * as React from "react"
import { FileUp, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog"
import { captureImportSummaryMessage, importCaptureFiles } from "./capture-import"

export default function CaptureImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void | Promise<void>
}) {
  const [files, setFiles] = React.useState<File[]>([])
  const [importing, setImporting] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  function setOpen(next: boolean) {
    if (!next && !importing) setFiles([])
    onOpenChange(next)
  }

  async function handleImport() {
    if (files.length === 0 || importing) return
    setImporting(true)
    try {
      const summary = await importCaptureFiles(files)
      const message = captureImportSummaryMessage(summary)
      const created = summary.bookmarksCreated + summary.resourcesCreated
      if (summary.failed > 0 && created === 0) {
        toast.error(message, { description: summary.lastError })
      } else if (summary.failed > 0) {
        toast.warning(message, { description: summary.lastError })
      } else {
        toast.success(message)
      }
      if (created > 0) await onImported()
      if (created > 0 || summary.duplicates > 0) {
        setFiles([])
        onOpenChange(false)
      }
    } catch (error) {
      toast.error("导入失败", { description: String(error) })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入到收件箱</DialogTitle>
          <DialogDescription>
            浏览器书签 HTML 会展开为书签；普通 HTML、PDF 和图片保留为本地文件。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <button
            type="button"
            disabled={importing}
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-6 text-center transition-colors hover:border-primary/50 hover:bg-accent/50 disabled:pointer-events-none disabled:opacity-60"
          >
            <FileUp className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-medium">
              {files.length > 0 ? `已选择 ${files.length} 个文件` : "点击选择要导入的文件"}
            </span>
            <span className="text-xs text-muted-foreground">
              支持 HTML、PDF、PNG、JPEG、WebP、SVG 等图片
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept=".html,.htm,text/html,.pdf,application/pdf,image/*"
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []))
              event.target.value = ""
            }}
          />
          {files.length > 0 ? (
            <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
              {files.slice(0, 5).map((file) => (
                <p key={`${file.name}:${file.size}`} className="truncate">
                  {file.name}
                </p>
              ))}
              {files.length > 5 ? <p>另有 {files.length - 5} 个文件…</p> : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={importing} onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button disabled={files.length === 0 || importing} onClick={() => void handleImport()}>
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {importing ? "导入中…" : "导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
