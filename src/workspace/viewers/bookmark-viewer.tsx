"use client"

// 节点查看器: 书签。经 FileSystem 取数 + 详情 (图标/标题/域名/描述/标签) + 打开外链。
import * as React from "react"
import { ExternalLink, Loader2 } from "lucide-react"
import { Button } from "@/ui/button"
import { openExternal } from "@/lib/safe-url"
import { renameNodeTab } from "../store"
import type { NodeViewerProps } from "../node-kind-ui"
import { useNodeFile } from "./use-node-file"

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export default function BookmarkViewer({ nodeId }: NodeViewerProps) {
  const { node: bm, loading, missing, error } = useNodeFile("bookmark", nodeId)
  const [iconError, setIconError] = React.useState(false)

  React.useEffect(() => {
    if (bm) {
      renameNodeTab({ kind: "bookmark", id: nodeId }, bm.title || bm.content.url || "书签")
    }
  }, [bm, nodeId])

  if (missing) {
    return <div className="p-6 text-sm text-muted-foreground">该书签不存在或已删除。</div>
  }
  if (error) {
    return <div className="p-6 text-sm text-muted-foreground">书签读取失败。</div>
  }
  if (loading || !bm) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        {bm.content.favicon && !iconError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bm.content.favicon}
            alt=""
            className="h-8 w-8 shrink-0 rounded"
            onError={() => setIconError(true)}
          />
        ) : (
          <div className="h-8 w-8 shrink-0 rounded bg-muted" />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold" title={bm.title || bm.content.url}>
            {bm.title || bm.content.url}
          </h1>
          <div className="truncate text-xs text-muted-foreground" title={bm.content.url}>
            {hostOf(bm.content.url)}
          </div>
        </div>
      </div>

      {bm.content.description && (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {bm.content.description}
        </p>
      )}

      {bm.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {bm.tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <div>
        <Button variant="outline" onClick={() => openExternal(bm.content.url)}>
          <ExternalLink className="mr-2 h-4 w-4" />
          打开链接
        </Button>
      </div>
    </div>
  )
}
