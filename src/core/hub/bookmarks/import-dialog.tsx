"use client"

import * as React from "react"
import { toast } from "sonner"
import { FileUp, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { BookmarkFolder } from "../model"
import { parseBookmarksHtml, ParsedBookmark } from "../lib/bookmark-import"
import { addFolder, bulkAddBookmarks } from "../lib/bookmarks-store"

export default function ImportDialog({
  open,
  onOpenChange,
  folders,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: BookmarkFolder[]
  onImported: () => void
}) {
  const [parsed, setParsed] = React.useState<ParsedBookmark[] | null>(null)
  const [fileName, setFileName] = React.useState("")
  const [keepFolders, setKeepFolders] = React.useState(true)
  const [importing, setImporting] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // 关闭时重置 (在事件回调里重置, 而非 effect)
  function handleOpenChange(next: boolean) {
    if (!next) {
      setParsed(null)
      setFileName("")
      setKeepFolders(true)
    }
    onOpenChange(next)
  }

  async function handleFile(file: File) {
    setFileName(file.name)
    try {
      const html = await file.text()
      const items = parseBookmarksHtml(html)
      setParsed(items)
      if (items.length === 0) {
        toast.warning("未在该文件中解析到书签")
      }
    } catch (e) {
      toast.error("解析失败", { description: String(e) })
      setParsed(null)
    }
  }

  const folderCount = React.useMemo(() => {
    if (!parsed) return 0
    const set = new Set(parsed.map((b) => b.folderPath.join(" / ")).filter(Boolean))
    return set.size
  }, [parsed])

  async function handleImport() {
    if (!parsed || parsed.length === 0) return
    setImporting(true)
    try {
      // 把已有收藏夹按名建索引, 复用同名夹
      const byName = new Map(folders.map((f) => [f.name, f.id]))

      const inputs = []
      for (const b of parsed) {
        let folderId: string | null = null
        if (keepFolders && b.folderPath.length) {
          // 用完整路径作为夹名 (如 "工作 / 文档"), 保证层级唯一
          const name = b.folderPath.join(" / ")
          let id = byName.get(name)
          if (!id) {
            const folder = await addFolder(name)
            id = folder.id
            byName.set(name, id)
          }
          folderId = id
        }
        inputs.push({
          title: b.title,
          url: b.url,
          favicon: b.favicon,
          folderId,
        })
      }
      await bulkAddBookmarks(inputs)
      toast.success(`已导入 ${inputs.length} 个书签`)
      onImported()
      handleOpenChange(false)
    } catch (e) {
      toast.error("导入失败", { description: String(e) })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入浏览器书签</DialogTitle>
          <DialogDescription>
            选择浏览器导出的书签文件 (.html)，在「书签管理器 → 导出」中生成。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-6 text-center transition-colors hover:border-primary/50 hover:bg-accent/50"
          >
            <FileUp className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-medium">{fileName || "点击选择书签文件"}</span>
            <span className="text-xs text-muted-foreground">支持 .html / .htm</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".html,.htm,text/html"
            hidden
            onChange={(e) => {
              if (e.target.files?.[0]) handleFile(e.target.files[0])
              e.target.value = ""
            }}
          />

          {parsed && parsed.length > 0 && (
            <>
              <div className="rounded-md bg-muted p-3 text-sm">
                解析到 <span className="font-semibold">{parsed.length}</span> 个书签，{folderCount}{" "}
                个收藏夹。
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={keepFolders}
                  onChange={(e) => setKeepFolders(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                <Label className="cursor-pointer">保留收藏夹结构</Label>
              </label>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleImport} disabled={!parsed || parsed.length === 0 || importing}>
            {importing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                导入中…
              </>
            ) : (
              "导入"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
