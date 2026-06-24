"use client"

// 节点查看器: 书签。自取数 (getBookmark) + 详情 (图标/标题/域名/描述/标签) + 打开外链。
import * as React from "react"
import { ExternalLink, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { openExternal } from "@/components/lib/safe-url"
import { getBookmark } from "@/app/home/lib/bookmarks-store"
import type { Bookmark } from "@/app/home/model"
import { renameNodeTab } from "../store"
import type { NodeViewerProps } from "../node-viewers"

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export default function BookmarkViewer({ nodeId }: NodeViewerProps) {
  const [bm, setBm] = React.useState<Bookmark | null>(null)
  const [missing, setMissing] = React.useState(false)
  const [iconError, setIconError] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    getBookmark(nodeId)
      .then((b) => {
        if (!alive) return
        if (b) {
          setBm(b)
          renameNodeTab({ kind: "bookmark", id: nodeId }, b.title || b.url || "书签")
        } else {
          setMissing(true)
        }
      })
      .catch(() => {
        if (alive) setMissing(true)
      })
    return () => {
      alive = false
    }
  }, [nodeId])

  if (missing) {
    return <div className="p-6 text-sm text-muted-foreground">该书签不存在或已删除。</div>
  }
  if (!bm) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        {bm.favicon && !iconError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bm.favicon}
            alt=""
            className="h-8 w-8 shrink-0 rounded"
            onError={() => setIconError(true)}
          />
        ) : (
          <div className="h-8 w-8 shrink-0 rounded bg-muted" />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold" title={bm.title || bm.url}>
            {bm.title || bm.url}
          </h1>
          <div className="truncate text-xs text-muted-foreground" title={bm.url}>
            {hostOf(bm.url)}
          </div>
        </div>
      </div>

      {bm.description && (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{bm.description}</p>
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
        <Button variant="outline" onClick={() => openExternal(bm.url)}>
          <ExternalLink className="mr-2 h-4 w-4" />
          打开链接
        </Button>
      </div>
    </div>
  )
}
