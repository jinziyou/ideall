"use client"

// 内嵌浏览器标签内容 (路线 A): 顶部工具条 + 下方内容占位区; 原生子 webview 铺满占位区。
import * as React from "react"
import { ArrowLeft, ArrowRight, Globe, RotateCw } from "lucide-react"
import { toast } from "sonner"
import { IconButton } from "@/ui/icon-button"
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
  browserShow,
  onBrowserUrl,
  browserGetBackend,
  type BrowserBounds,
  type BrowserBackendInfo,
} from "@/lib/tauri"
import { subscribePendingBrowserUrl, takePendingBrowserUrl } from "./browser-open"
import { setBrowserUrl, setBrowserBackend } from "./browser-state"

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
  const initialUrl = React.useMemo(() => takePendingBrowserUrl() ?? START_URL, [])
  const currentUrlRef = React.useRef(initialUrl)
  const [addr, setAddr] = React.useState(initialUrl)
  const [backend, setBackend] = React.useState<BrowserBackendInfo | null>(null)

  React.useEffect(() => {
    if (!isTauri()) return
    browserGetBackend()
      .then((info) => {
        setBackend(info)
        setBrowserBackend(info.mode)
      })
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    setBrowserUrl(initialUrl)
  }, [initialUrl])

  React.useEffect(() => {
    return subscribePendingBrowserUrl((url) => {
      currentUrlRef.current = url
      setAddr(url)
      setBrowserUrl(url)
      if (openedRef.current) {
        browserNavigate(url).catch(() => toast.error("导航失败"))
        browserShow().catch(() => {})
      }
    })
  }, [])

  React.useEffect(() => {
    if (!isTauri()) return
    let unUrl: (() => void) | undefined
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
        openBrowserView(currentUrlRef.current, b)
          .then(() => browserGetBackend().then((info) => setBackend(info)).catch(() => {}))
          .catch(() => {
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
      setBrowserUrl(u)
    }).then((u) => {
      unUrl = u
    })

    const el = contentRef.current
    if (el) {
      ro = new ResizeObserver(schedule)
      ro.observe(el)
    }
    window.addEventListener("resize", schedule)
    schedule()

    return () => {
      unUrl?.()
      ro?.disconnect()
      window.removeEventListener("resize", schedule)
      cancelAnimationFrame(raf)
      browserClose().catch(() => {})
      openedRef.current = false
      setBrowserBackend(null)
    }
  }, [])

  const go = (raw?: string) => {
    const v = normalizeInput(raw ?? addr)
    if (!v) return
    currentUrlRef.current = v
    setAddr(v)
    browserNavigate(v).catch(() => toast.error("导航失败"))
  }

  if (!tauri) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-muted/25 p-6 text-center text-muted-foreground">
        <Globe className="h-8 w-8 opacity-60" />
        <p className="text-sm">内嵌浏览器仅在桌面 App 可用。</p>
        <p className="text-xs">当前为网页形态；请在桌面 App 里使用。</p>
      </div>
    )
  }

  const backendLabel =
    backend?.mode === "cdp"
      ? "Chrome CDP"
      : backend?.mode === "webkit"
        ? "WebKit"
        : backend?.mode === "webview"
          ? "WebView"
          : null

  return (
    <div className="flex h-full flex-col bg-muted/25 p-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
        {/* 工具条 (可信本地 DOM; 与下方子 webview 区域严格不重叠) */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          {backendLabel ? (
            <span
              title={
                backend?.mode === "cdp"
                  ? backend.chromePath ?? "Chrome CDP 模式"
                  : undefined
              }
              className="shrink-0 rounded-md border bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {backendLabel}
            </span>
          ) : null}
          <IconButton onClick={() => browserBack().catch(() => {})} title="后退" aria-label="后退">
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
          <IconButton
            onClick={() => browserForward().catch(() => {})}
            title="前进"
            aria-label="前进"
          >
            <ArrowRight className="h-4 w-4" />
          </IconButton>
          <IconButton
            onClick={() => browserReload().catch(() => {})}
            title="刷新"
            aria-label="刷新"
          >
            <RotateCw className="h-4 w-4" />
          </IconButton>
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
              className="h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </form>
        </div>
        {/* 内容占位区: 原生子 webview 或 CDP Chrome 窗口对齐此矩形 */}
        <div ref={contentRef} className="relative min-h-0 flex-1 bg-background">
          {backend?.mode === "cdp" ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 p-6 text-center text-muted-foreground">
              <Globe className="h-6 w-6 opacity-40" />
              <p className="text-xs">Chrome 独立窗口 (CDP)</p>
              <p className="max-w-xs text-[11px] opacity-70">
                页面在独立 Chrome 窗口中渲染，与本区域对齐；切换标签或缩放窗口时会自动同步位置。
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
