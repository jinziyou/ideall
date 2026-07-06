// XState Stately Inspector —— 开发态可视化 auth/sync 状态机。
// 接收页必须是 https://stately.ai/inspect (不是 /registry/inspect)。
import type { InspectionEvent, Observer } from "xstate"

const INSPECTOR_URL = "https://stately.ai/inspect"

type InspectObserver = Observer<InspectionEvent>
type BrowserInspector = {
  inspect: InspectObserver
  start: () => void
}

let inspectFn: InspectObserver | undefined
let initPromise: Promise<void> | undefined
let pendingIframe: HTMLIFrameElement | undefined

function inspectDisabled(): boolean {
  if (process.env.NODE_ENV === "production") return true
  if (typeof window === "undefined") return true
  return process.env.NEXT_PUBLIC_XSTATE_INSPECT !== "1"
}

async function waitForIframeRegistration(): Promise<void> {
  if (pendingIframe) return
  for (let i = 0; i < 40; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    if (pendingIframe) return
  }
}

function createInspectorInstance(
  createBrowserInspector: (options?: {
    url?: string
    iframe?: HTMLIFrameElement | null
  }) => BrowserInspector,
): BrowserInspector {
  const iframe = pendingIframe
  if (iframe) {
    console.info(`[ideall] XState Inspector 使用内嵌 iframe → ${INSPECTOR_URL}`)
    return createBrowserInspector({ url: INSPECTOR_URL, iframe })
  }

  console.info(
    `[ideall] XState Inspector 弹窗 → ${INSPECTOR_URL}\n` +
      "若页面空白, 请确认是 stately.ai/inspect (不是 registry/inspect)。",
  )
  return createBrowserInspector({ url: INSPECTOR_URL })
}

/** 内嵌面板挂载 iframe 后调用 (幂等, 可早于 init)。 */
export function registerXStateInspectorIframe(iframe: HTMLIFrameElement): void {
  if (inspectDisabled()) return
  iframe.id = "xstate-inspector-frame"
  pendingIframe = iframe
  void initXStateInspector()
}

/** 客户端启动时调用; 优先等内嵌 iframe, 否则 fallback 到 window.open。 */
export function initXStateInspector(): Promise<void> {
  if (inspectDisabled()) return Promise.resolve()
  if (inspectFn) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    await waitForIframeRegistration()
    const { createBrowserInspector } = await import("@statelyai/inspect")
    const inspector = createInspectorInstance(createBrowserInspector)
    inspector.start()
    inspectFn = inspector.inspect
  })().catch((err) => {
    // Dev HMR 会使 @statelyai/inspect 的 chunk 哈希失效; 仅 warn 一次, 不反复重试。
    if (process.env.NODE_ENV === "development") {
      console.warn("[ideall] XState Inspector 初始化失败 (开发态 HMR 常见, 刷新即可):", err)
    } else {
      console.warn("[ideall] XState Inspector 初始化失败:", err)
    }
    initPromise = undefined
  }) as Promise<void>
  return initPromise
}

/** createActor 的 inspect 选项 (未初始化时为空对象)。 */
export function actorInspectOptions(): { inspect?: InspectObserver } {
  const inspect = inspectFn
  return inspect ? { inspect } : {}
}

/** 跑 actor 前确保 Inspector 已就绪 (动态 import 异步)。 */
export async function ensureXStateInspector(): Promise<void> {
  await initXStateInspector()
}

export function isXStateInspectorReady(): boolean {
  return !!inspectFn
}

export function getXStateInspectorUrl(): string {
  return INSPECTOR_URL
}
