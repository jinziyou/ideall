"use client"

// 节点查看器: 文件。自取数 (useFilePreview) + 按 mime 分派预览 (FilePreviewBox) + 下载。
// 复用 home/resources/file-preview 的核心 (与预览对话框同一逻辑, 不 fork)。onLoaded 回填标签标题。
import * as React from "react"
import { Download } from "lucide-react"
import { Button } from "@/ui/button"
import { formatBytes } from "@/lib/node-format"
import {
  useFilePreview,
  FilePreviewBox,
  downloadStoredFile,
} from "@/modules/home/resources/file-preview"
import { renameNodeTab } from "../store"
import type { NodeViewerProps } from "../node-viewers"

export default function FileViewer({ nodeId }: NodeViewerProps) {
  const preview = useFilePreview(nodeId)
  const { file, loading } = preview

  React.useEffect(() => {
    if (file) renameNodeTab({ kind: "file", id: nodeId }, file.name)
  }, [file, nodeId])

  if (!loading && !file) {
    return <div className="p-6 text-sm text-muted-foreground">该文件不存在或已删除。</div>
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="shrink-0">
        <h1 className="truncate text-lg font-semibold" title={file?.name}>
          {file?.name ?? "加载中…"}
        </h1>
        {file && (
          <p className="text-xs text-muted-foreground">
            {file.type || "未知类型"} · {formatBytes(file.size)}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <FilePreviewBox {...preview} fill />
      </div>
      {file && (
        <div className="shrink-0">
          <Button variant="outline" onClick={() => downloadStoredFile(file)}>
            <Download className="mr-2 h-4 w-4" />
            下载
          </Button>
        </div>
      )}
    </div>
  )
}
