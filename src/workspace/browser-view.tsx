"use client"

// 内嵌浏览器标签内容 (路线 A): 顶部工具条 + 下方内容占位区; 原生子 webview 对齐占位区 (Windows/macOS/Linux)。
import * as React from "react"
import {
  ArrowLeft,
  ArrowRight,
  BookmarkCheck,
  BookmarkPlus,
  FileCheck2,
  FileDown,
  Globe,
  Highlighter,
  Loader2,
  RotateCw,
} from "lucide-react"
import { toast } from "sonner"
import { IconButton } from "@/ui/icon-button"
import { safeHref } from "@/lib/safe-url"
import {
  isTauri,
  openBrowserView,
  browserPresent,
  browserNavigate,
  browserBack,
  browserForward,
  browserReload,
  browserRelease,
  onBrowserUrl,
  browserGetBackend,
  type BrowserBounds,
  type BrowserBackendInfo,
} from "@/lib/tauri"
import { setBrowserUrl, setBrowserBackend } from "@/lib/browser-state"
import {
  captureCurrentBrowserExcerpt,
  captureCurrentBrowserPage,
  captureCurrentBrowserSnapshot,
} from "./browser-capture"
import { subscribePendingBrowserUrl, takePendingBrowserUrl } from "./browser-open"
import { useTabActive } from "./tab-active-context"
import {
  captureBookmarkSuccessToast,
  captureOnboardingToastGuide,
} from "@/shared/feeders/capture-bookmark-feedback"

const START_URL = "https://www.google.com"
/** TopBar(44) + TabBar(36) + 浏览器卡片边距/工具条(≈64); 低于此 y 会盖住壳层 (HWND 在 CSS 之上)。 */
const MIN_CONTENT_TOP_PX = 140
const MIN_CONTENT_LEFT_PX = 48

function normalizeInput(v: string): string {
  const t = v.trim()
  if (!t) return ""
  if (/^https?:\/\//i.test(t)) return t
  if (/^localhost(?:[:/]|$)/i.test(t) || /^127\.0\.0\.1/.test(t)) {
    return `http://${t}`
  }
  return `https://${t}`
}

/** 首帧布局未完成时占位区可能暂时≈整窗, 此时创建子 webview 会挡全窗点击。 */
function saneContentBounds(r: DOMRect): boolean {
  if (r.width < 8 || r.height < 8) return false
  if (typeof window === "undefined") return true
  if (r.top < MIN_CONTENT_TOP_PX || r.left < MIN_CONTENT_LEFT_PX) return false
  if (r.width > window.innerWidth * 0.92 || r.height > window.innerHeight * 0.88) {
    return false
  }
  return true
}

function boundsEqual(a: BrowserBounds, b: BrowserBounds): boolean {
  const eps = 0.5
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.w - b.w) < eps &&
    Math.abs(a.h - b.h) < eps
  )
}

/** 连续两帧 bounds 一致才认为布局稳定, 避免首帧整窗尺寸创建子 HWND。 */
async function waitStableBounds(
  read: () => BrowserBounds | null,
  maxFrames = 12,
): Promise<BrowserBounds | null> {
  let prev: BrowserBounds | null = null
  for (let i = 0; i < maxFrames; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const cur = read()
    if (cur && prev && boundsEqual(cur, prev)) return cur
    prev = cur
  }
  return read()
}

export default function BrowserView({ initialUrl: initialUrlProp }: { initialUrl?: string }) {
  const tabActive = useTabActive()
  const tauri = React.useSyncExternalStore(
    () => () => {},
    () => isTauri(),
    () => false,
  )
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const toolbarRef = React.useRef<HTMLDivElement | null>(null)
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const openedRef = React.useRef(false)
  const initialUrl = React.useMemo(
    () => takePendingBrowserUrl() ?? safeHref(initialUrlProp ?? "") ?? START_URL,
    [initialUrlProp],
  )
  const currentUrlRef = React.useRef(initialUrl)
  const [addr, setAddr] = React.useState(initialUrl)
  const [backend, setBackend] = React.useState<BrowserBackendInfo | null>(null)
  const [captureState, setCaptureState] = React.useState<"idle" | "saving" | "saved">("idle")
  const [snapshotState, setSnapshotState] = React.useState<"idle" | "saving" | "saved">("idle")
  const [excerptState, setExcerptState] = React.useState<"idle" | "saving" | "saved">("idle")
  const captureRunningRef = React.useRef(false)

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

  const tabActiveRef = React.useRef(tabActive)

  React.useEffect(() => {
    tabActiveRef.current = tabActive
  }, [tabActive])

  const boundsOf = React.useCallback((): BrowserBounds | null => {
    const el = contentRef.current
    const toolbar = toolbarRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (!saneContentBounds(r)) return null
    if (toolbar) {
      const tb = toolbar.getBoundingClientRect()
      if (r.top < tb.bottom - 1) return null
    }
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }, [])

  // open_browser_view 是 async 命令 (Windows 防死锁), 与 browser_present 可能并发;
  // present 抢在 add_child 完成前执行会报「浏览器视图不存在」→ releaseNative 把刚建的
  // webview 关掉。这里用 promise 队列把原生浏览器操作串行化, 保证 open → present 顺序。
  const opQueueRef = React.useRef<Promise<unknown>>(Promise.resolve())
  const enqueue = React.useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = opQueueRef.current.then(fn, fn)
    opQueueRef.current = next.catch(() => {})
    return next
  }, [])

  const releaseNative = React.useCallback(async () => {
    openedRef.current = false
    await enqueue(() => browserRelease().catch(() => {}))
  }, [enqueue])

  const presentAt = React.useCallback(
    async (b: BrowserBounds) => {
      await enqueue(async () => {
        // 队列中排在前面的 release/open 可能已改变状态; 复查后再 present。
        if (!openedRef.current) return
        try {
          await browserPresent(b)
        } catch {
          openedRef.current = false
          await browserRelease().catch(() => {})
        }
      })
    },
    [enqueue],
  )

  const openAt = React.useCallback(
    async (b: BrowserBounds) => {
      openedRef.current = true
      await enqueue(async () => {
        try {
          await openBrowserView(currentUrlRef.current, b)
          // 等子 webview 在屏外创建完成后再 present, 避免首帧以错误尺寸参与命中测试。
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          })
          await browserPresent(b)
          const info = await browserGetBackend()
          setBackend(info)
          setBrowserBackend(info.mode)
        } catch (e) {
          openedRef.current = false
          await browserRelease().catch(() => {})
          const msg = e instanceof Error ? e.message : String(e)
          console.error("[browser-view] openAt failed:", e)
          toast.error(`打开内嵌浏览器失败: ${msg}`)
        }
      })
    },
    [enqueue],
  )

  const syncBrowser = React.useCallback(async () => {
    if (!isTauri()) return
    if (!tabActiveRef.current) {
      await releaseNative()
      return
    }
    const b = await waitStableBounds(boundsOf)
    if (!b) {
      await releaseNative()
      return
    }
    if (!openedRef.current) {
      await openAt(b)
      return
    }
    await presentAt(b)
  }, [boundsOf, openAt, presentAt, releaseNative])

  const ensureBrowserReady = React.useCallback(async (): Promise<boolean> => {
    if (!isTauri()) return false
    if (!tabActiveRef.current) return false
    const b = await waitStableBounds(boundsOf)
    if (!b) return false
    if (!openedRef.current) {
      await openAt(b)
    } else {
      await presentAt(b)
    }
    return openedRef.current
  }, [boundsOf, openAt, presentAt])

  React.useEffect(() => {
    return subscribePendingBrowserUrl((url) => {
      currentUrlRef.current = url
      setAddr(url)
      setBrowserUrl(url)
      setCaptureState("idle")
      setSnapshotState("idle")
      setExcerptState("idle")
      if (openedRef.current) {
        browserNavigate(url).catch(() => toast.error("导航失败"))
        const b = boundsOf()
        if (b) void presentAt(b)
      }
    })
  }, [boundsOf, presentAt])

  React.useEffect(() => {
    if (!isTauri()) return
    if (!tabActive) {
      void releaseNative()
      return
    }
    const raf = requestAnimationFrame(() => {
      void syncBrowser()
    })
    return () => cancelAnimationFrame(raf)
  }, [tabActive, releaseNative, syncBrowser])

  React.useEffect(() => {
    if (!isTauri()) return
    let unUrl: (() => void) | undefined
    let ro: ResizeObserver | undefined
    let raf = 0

    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        void syncBrowser()
      })
    }

    onBrowserUrl((u) => {
      currentUrlRef.current = u
      setAddr(u)
      setBrowserUrl(u)
      setCaptureState("idle")
      setSnapshotState("idle")
      setExcerptState("idle")
    }).then((u) => {
      unUrl = u
    })

    const observe = cardRef.current ?? contentRef.current
    if (observe) {
      ro = new ResizeObserver(schedule)
      ro.observe(observe)
    }
    window.addEventListener("resize", schedule)
    schedule()

    return () => {
      unUrl?.()
      ro?.disconnect()
      window.removeEventListener("resize", schedule)
      cancelAnimationFrame(raf)
      void releaseNative()
      setBrowserBackend(null)
    }
  }, [releaseNative, syncBrowser])

  const go = async (raw?: string) => {
    const v = normalizeInput(raw ?? addr)
    if (!v) return
    currentUrlRef.current = v
    setAddr(v)
    setBrowserUrl(v)
    setCaptureState("idle")
    setSnapshotState("idle")
    setExcerptState("idle")
    if (!(await ensureBrowserReady())) {
      toast.error("浏览器尚未就绪，请稍候再试")
      return
    }
    try {
      await browserNavigate(v)
    } catch {
      toast.error("导航失败")
    }
  }

  const capturePage = async () => {
    if (captureRunningRef.current) return
    if (!(await ensureBrowserReady())) {
      toast.error("浏览器尚未就绪，请稍候再试")
      return
    }
    captureRunningRef.current = true
    setCaptureState("saving")
    try {
      const result = await captureCurrentBrowserPage()
      setCaptureState("saved")
      captureBookmarkSuccessToast({
        status: result.status,
        title: result.title,
      })
    } catch (error) {
      setCaptureState("idle")
      toast.error("保存当前页面失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      captureRunningRef.current = false
    }
  }

  const captureSnapshot = async () => {
    if (captureRunningRef.current) return
    if (!(await ensureBrowserReady())) {
      toast.error("浏览器尚未就绪，请稍候再试")
      return
    }
    captureRunningRef.current = true
    setSnapshotState("saving")
    try {
      const result = await captureCurrentBrowserSnapshot()
      setSnapshotState("saved")
      const guide = result.status === "created" ? captureOnboardingToastGuide() : null
      toast.success(result.status === "existing" ? "当前页面已有离线快照" : "已保存离线快照", {
        description: result.truncated ? `${result.title} · 正文过长，已截断保存` : result.title,
        ...(guide?.action ? { action: guide.action } : {}),
      })
    } catch (error) {
      setSnapshotState("idle")
      toast.error("保存离线快照失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      captureRunningRef.current = false
    }
  }

  const captureExcerpt = async () => {
    if (captureRunningRef.current) return
    if (!(await ensureBrowserReady())) {
      toast.error("浏览器尚未就绪，请稍候再试")
      return
    }
    captureRunningRef.current = true
    setExcerptState("saving")
    try {
      const result = await captureCurrentBrowserExcerpt()
      setExcerptState("saved")
      const guide = result.status === "created" ? captureOnboardingToastGuide() : null
      toast.success(result.status === "existing" ? "这段摘录已经保存" : "已保存选中文本", {
        description: result.excerpt,
        ...(guide?.action ? { action: guide.action } : {}),
      })
    } catch (error) {
      setExcerptState("idle")
      toast.error("保存网页摘录失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      captureRunningRef.current = false
    }
  }

  const captureBusy =
    captureState === "saving" || snapshotState === "saving" || excerptState === "saving"

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
      <div
        ref={cardRef}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card"
      >
        <div
          ref={toolbarRef}
          data-browser-toolbar
          className="relative z-10 flex h-12 shrink-0 items-center gap-2 border-b px-4"
        >
          {backendLabel ? (
            <span
              title={
                backend?.mode === "cdp" ? (backend.chromePath ?? "Chrome CDP 模式") : undefined
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
              void go()
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
          <IconButton
            onClick={() => void capturePage()}
            disabled={captureBusy}
            aria-label={captureState === "saved" ? "当前页面已保存" : "保存当前页面到书签"}
            aria-pressed={captureState === "saved"}
            title={captureState === "saved" ? "已保存到书签" : "保存到书签"}
            className={captureState === "saved" ? "text-primary" : undefined}
          >
            {captureState === "saving" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : captureState === "saved" ? (
              <BookmarkCheck className="h-4 w-4" />
            ) : (
              <BookmarkPlus className="h-4 w-4" />
            )}
          </IconButton>
          <IconButton
            onClick={() => void captureSnapshot()}
            disabled={captureBusy}
            aria-label={snapshotState === "saved" ? "当前页面已有离线快照" : "保存当前页面离线快照"}
            aria-pressed={snapshotState === "saved"}
            title={snapshotState === "saved" ? "已保存离线快照" : "保存离线快照"}
            className={snapshotState === "saved" ? "text-primary" : undefined}
          >
            {snapshotState === "saving" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : snapshotState === "saved" ? (
              <FileCheck2 className="h-4 w-4" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
          </IconButton>
          <IconButton
            onClick={() => void captureExcerpt()}
            disabled={captureBusy}
            aria-label={excerptState === "saved" ? "选中文本已保存" : "保存选中文本为网页摘录"}
            aria-pressed={excerptState === "saved"}
            title={excerptState === "saved" ? "选中文本已保存" : "保存选中文本"}
            className={excerptState === "saved" ? "text-primary" : undefined}
          >
            {excerptState === "saving" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Highlighter className="h-4 w-4" />
            )}
          </IconButton>
        </div>
        <div ref={contentRef} className="relative z-0 min-h-0 flex-1 bg-background">
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
