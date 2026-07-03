"use client"

import { useCallback, useState } from "react"
import { registerXStateInspectorIframe } from "@/lib/xstate-inspector"

const INSPECTOR_URL = "https://stately.ai/inspect"

/** 开发态内嵌 Stately Inspector (Tauri / 禁弹窗环境用 iframe 代替 window.open)。 */
export default function XStateInspectorPanel() {
  const [open, setOpen] = useState(true)
  const iframeRef = useCallback((el: HTMLIFrameElement | null) => {
    if (el) registerXStateInspectorIframe(el)
  }, [])

  if (process.env.NODE_ENV === "production") return null
  if (process.env.NEXT_PUBLIC_XSTATE_INSPECT === "0") return null

  return (
    <div
      className="fixed bottom-2 right-2 z-[9999] flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg"
      style={{ width: open ? 420 : 160, height: open ? 320 : 36 }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1 text-xs text-muted-foreground">
        <span className="truncate">XState Inspector</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded px-1.5 py-0.5 hover:bg-muted"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "收起" : "展开"}
          </button>
          <a
            href={INSPECTOR_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded px-1.5 py-0.5 hover:bg-muted"
          >
            新窗口
          </a>
        </div>
      </div>
      <div className={open ? "min-h-0 flex-1" : "hidden"}>
        <iframe
          ref={iframeRef}
          title="Stately XState Inspector"
          src={INSPECTOR_URL}
          className="h-full w-full border-0 bg-background"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  )
}
