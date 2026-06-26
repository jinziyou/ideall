"use client"

// 内嵌浏览器标签内容 (路线 A): 顶部工具条 (主窗口可信 DOM) + 下方内容占位区。
// 原生子 webview 由 Rust 覆盖到「内容占位区」矩形之上 (它在 HTML 之上, 故工具条与占位区必须不重叠)。
// bounds 用 ResizeObserver + window resize 同步; 标签切到后台 (display:none → 占位区尺寸 0) 则 hide。
// 收藏由本组件 (可信本地前端) 直接写本地书签, 不依赖外站 webview 的 IPC (Tauri v2 不向外站注入 IPC)。
import * as React from "react"
import { ArrowLeft, ArrowRight, Globe, RotateCw, Star } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  isTauri,
  openBrowserView,
  browserSetBounds,
  browserNavigate,
  browserBack,
  browserForward,
  browserReload,
  browserHide,
  browserClose,
  onBrowserUrl,
  type BrowserBounds,
} from "@/lib/tauri"

const START_URL = "https://www.google.com"

function normalizeInput(v: string): string {
  const t = v.trim()
  if (!t) return ""
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

export default function BrowserView() {
  const tauri = React.useSyncExternalStore(
    () => () => {},
    () => isTauri(),
    () => false,
  )
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const openedRef = React.useRef(false)
  const currentUrlRef = React.useRef(START_URL)
  const [addr, setAddr] = React.useState(START_URL)

  React.useEffect(() => {
    if (!isTauri()) return
    let un: (() => void) | undefined
    let ro: ResizeObserver | undefined
    let raf = 0

    const boundsOf = (): BrowserBounds | null => {
      const el = contentRef.current
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    }
    const sync = () => {
      const b = boundsOf()
      if (!b) return
      if (b.w < 1 || b.h < 1) {
        // 标签切到后台 (display:none) → 隐藏原生层, 免遮挡其它标签的 DOM。
        if (openedRef.current) browserHide().catch(() => {})
        return
      }
      if (!openedRef.current) {
        openedRef.current = true
        openBrowserView(currentUrlRef.current, b).catch(() => {
          openedRef.current = false
          toast.error("打开内嵌浏览器失败")
        })
      } else {
        // 已开 (含从后台切回): set_bounds 会同时让其重新可见并对齐。
        browserSetBounds(b).catch(() => {})
      }
    }
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(sync)
    }

    onBrowserUrl((u) => {
      currentUrlRef.current = u
      setAddr(u)
    }).then((u) => {
      un = u
    })

    const el = contentRef.current
    if (el) {
      ro = new ResizeObserver(schedule)
      ro.observe(el)
    }
    window.addEventListener("resize", schedule)
    schedule()

    return () => {
      un?.()
      ro?.disconnect()
      window.removeEventListener("resize", schedule)
      cancelAnimationFrame(raf)
      browserClose().catch(() => {})
      openedRef.current = false
    }
  }, [])

  const go = (raw?: string) => {
    const v = normalizeInput(raw ?? addr)
    if (!v) return
    currentUrlRef.current = v
    setAddr(v)
    browserNavigate(v).catch(() => toast.error("导航失败"))
  }

  const favorite = () => {
    void (async () => {
      const { safeHref } = await import("@/lib/safe-url")
      const href = safeHref(currentUrlRef.current)
      if (!href) {
        toast.error("当前页地址无效")
        return
      }
      const { addBookmark, listBookmarks } = await import("@/files/stores/bookmarks-store")
      const norm = (u: string) => u.replace(/[/#?]+$/, "")
      const existing = await listBookmarks()
      if (existing.some((b) => norm(b.url) === norm(href))) {
        toast("该网页已在书签中")
        return
      }
      let title = href
      try {
        title = new URL(href).hostname
      } catch {
        /* 用 href 兜底 */
      }
      await addBookmark({ url: href, title })
      toast.success("已收藏到书签")
    })()
  }

  if (!tauri) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <Globe className="h-8 w-8 opacity-60" />
        <p className="text-sm">内嵌浏览器仅在桌面 App 可用。</p>
        <p className="text-xs">当前为网页形态；请在桌面 App 里使用。</p>
      </div>
    )
  }

  const iconBtn =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-shell text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"

  return (
    <div className="flex h-full flex-col">
      {/* 工具条 (可信本地 DOM; 与下方子 webview 区域严格不重叠) */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b bg-card px-2">
        <button
          type="button"
          onClick={() => browserBack().catch(() => {})}
          title="后退"
          className={iconBtn}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => browserForward().catch(() => {})}
          title="前进"
          className={iconBtn}
        >
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => browserReload().catch(() => {})}
          title="刷新"
          className={iconBtn}
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            go()
          }}
          className="flex min-w-0 flex-1 items-center"
        >
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            spellCheck={false}
            aria-label="网址"
            placeholder="输入网址，回车打开…"
            className="h-7 w-full min-w-0 rounded-shell border bg-background px-2.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </form>
        <button
          type="button"
          onClick={favorite}
          title="收藏当前页到书签"
          className={cn(iconBtn, "w-auto gap-1 px-2 text-xs")}
        >
          <Star className="h-3.5 w-3.5" />
          收藏
        </button>
      </div>
      {/* 内容占位区: 原生子 webview 覆盖此矩形 (本 div 不渲染网页内容) */}
      <div ref={contentRef} className="min-h-0 flex-1 bg-muted/20" />
    </div>
  )
}
