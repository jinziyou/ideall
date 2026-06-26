"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw, WifiOff } from "lucide-react"
import { Button } from "@/ui/button"
import { cn } from "@/lib/utils"
import { useOnlineStatus } from "@/lib/use-online-status"
import { MessagePortTransport } from "./transport"
import { createLocalMcpServer } from "./local-mcp-server"
import { firstPartyGrant } from "./grant"
import {
  HELLO_MESSAGE_TYPE,
  INIT_MESSAGE_TYPE,
  PROTOCOL_VERSION,
  type ThemeTokens,
} from "./protocol"
import type { Manifest } from "./manifest"

function currentTheme(): ThemeTokens {
  const dark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  return { mode: dark ? "dark" : "light" }
}

/**
 * EmbedHost —— 宿主壳: 把一个嵌入应用 (manifest) 以 iframe + postMessage + MCP 内嵌进 ideall。
 *  - 握手: 仅在被嵌入页 hello 后建桥 (不在 iframe load 时发 init —— load 早于 portal JS 就绪会丢 init 且 started 守卫阻重试)。
 *  - 能力面: 起 McpServer, 只注册 manifest 授权的 tool/resource, 经 mcpPort 通信。
 *  - UI 面: uiPort 推送主题 (初始 + 变更) / 接收页面 ready 撤 loading。
 *  - 卸载: 关闭 server 与端口, 断开观察器。
 *  - 失败兜底 (M-1): 加载超时 / iframe onError / 源校验失败 → failed 态, 渲染「重试」卡片
 *    (零后端 / 断网 / 服务不可达时不再永久转圈); 重试经 reloadKey 重建 iframe。
 */
// 加载超时: 起桥后多久未收到页面 'ready' 即判失败 (覆盖断网 / 零后端 / 服务不可达)。
const LOAD_TIMEOUT_MS = 12_000

type EmbedStatus = "loading" | "ready" | "failed"

export function EmbedHost({ manifest }: { manifest: Manifest }) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const router = useRouter()
  const [status, setStatus] = React.useState<EmbedStatus>("loading")
  const [reloadKey, setReloadKey] = React.useState(0)
  const online = useOnlineStatus()

  // 同步可判的配置校验 (URL 合法 / 源在白名单 / 非同源)。放 useMemo 而非 effect:
  // effect 体内同步 setState 会触发级联渲染 (react-hooks/set-state-in-effect)。配置错误直接进 failed。
  const { entryOrigin, embedSrc, configError } = React.useMemo<{
    entryOrigin: string | null
    embedSrc: string | null
    configError: string | null
  }>(() => {
    let url: URL
    try {
      url = new URL(manifest.entry)
    } catch {
      return {
        entryOrigin: null,
        embedSrc: null,
        configError: `manifest.entry 非法 URL: ${manifest.entry}`,
      }
    }
    const origin = url.origin
    // 一致性断言: entry 源必须在 manifest.origins 白名单内 (防 env 错配下向非预期源发 init)。
    if (manifest.origins.length > 0 && !manifest.origins.includes(origin)) {
      return {
        entryOrigin: null,
        embedSrc: null,
        configError: `entry 源 ${origin} 不在 manifest.origins 白名单内 (检查 NEXT_PUBLIC_EMBED_BASE)`,
      }
    }
    // 安全断言: 嵌入源绝不可与宿主同源。sandbox 含 allow-same-origin, 同源会让 iframe 获宿主 localStorage
    // (account token / 同步码), 击穿「token 不出宿主」隔膜。
    if (typeof location !== "undefined" && origin === location.origin) {
      return {
        entryOrigin: null,
        embedSrc: null,
        configError: `entry 源 ${origin} 与宿主同源 (嵌入源须跨域以隔离宿主 localStorage)`,
      }
    }
    // 嵌入态信号 (URL 标记): 被嵌入页首帧即可据 ?embed=ideall 去掉自身导航/头尾 (外壳由 ideall 提供),
    // 无需等异步 ideall:init 握手 → 消除「init 到达前导航闪一下」。契约见 docs/ideall-embed-bridge.md §11。
    // query 标记不改 origin, 不影响上方源校验与 postMessage 的 targetOrigin (= entryOrigin)。
    url.searchParams.set("embed", "ideall")
    url.searchParams.set("embedApp", manifest.id)
    return { entryOrigin: origin, embedSrc: url.toString(), configError: null }
  }, [manifest])

  // 配置错误直接渲染 failed; 运行期失败 (超时 / iframe onError) 走 status。
  const effectiveStatus: EmbedStatus = configError ? "failed" : status

  const retry = React.useCallback(() => {
    setStatus("loading")
    setReloadKey((k) => k + 1) // 改 iframe key → 强制重建, 重新走握手
  }, [])

  React.useEffect(() => {
    if (configError) {
      console.error("[EmbedHost]", configError)
      return
    }
    const iframe = iframeRef.current
    if (!iframe || !entryOrigin) return

    // 超时兜底: 到点仍未 ready 即判失败 (ready 时会清掉此定时器)。
    const failTimer = window.setTimeout(() => setStatus("failed"), LOAD_TIMEOUT_MS)

    let started = false
    const cleanups: Array<() => void> = []

    const startBridge = () => {
      if (started) return
      const win = iframe.contentWindow
      if (!win) return
      started = true

      const mcp = new MessageChannel()
      const ui = new MessageChannel()

      // 端口移交: 把两条 channel 的 port2 转移给 iframe (此后点对点, 不再 window 广播)。
      win.postMessage(
        {
          type: INIT_MESSAGE_TYPE,
          protocol: PROTOCOL_VERSION,
          appId: manifest.id,
          permissions: manifest.permissions,
          theme: currentTheme(),
        },
        entryOrigin,
        [mcp.port2, ui.port2],
      )

      // 能力面: 每个 iframe 一个独立 server + 独立授权集。
      // 一方 manifest → T0 Grant (自动/不过期/不可撤), 能力层据 Grant 起 server (与 transport 解耦)。
      const grant = firstPartyGrant(manifest, Date.now())
      const server = createLocalMcpServer(grant, { navigate: (r) => router.push(r) })
      void server.connect(new MessagePortTransport(mcp.port1))

      // UI 面 (uiPort): 接收页面事件 + 推送主题。
      const uiPort = ui.port1
      uiPort.onmessage = (e: MessageEvent) => {
        const msg = e.data as { type?: string } | undefined
        if (msg?.type === "ready") {
          window.clearTimeout(failTimer)
          setStatus("ready")
        }
        // set-title / request-resize / loading: 当前外壳不需要 (iframe 满高), 预留。
      }
      uiPort.start()

      const sendTheme = () => uiPort.postMessage({ type: "theme", payload: currentTheme() })
      const obs = new MutationObserver(sendTheme)
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })

      cleanups.push(() => {
        obs.disconnect()
        void server.close()
        try {
          mcp.port1.close()
        } catch {
          /* ignore */
        }
        try {
          uiPort.close()
        } catch {
          /* ignore */
        }
      })
    }

    // 仅响应 hello 建桥: portal 每 200ms 重发 hello 直到收到 init; load 时 JS 常未就绪, 提前 init 会丢包。
    const onHello = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return
      if (e.origin !== entryOrigin) return
      if ((e.data as { type?: string } | undefined)?.type !== HELLO_MESSAGE_TYPE) return
      startBridge()
    }
    window.addEventListener("message", onHello)

    return () => {
      window.clearTimeout(failTimer)
      window.removeEventListener("message", onHello)
      cleanups.forEach((f) => f())
    }
  }, [manifest, router, reloadKey, configError, entryOrigin])

  return (
    // 高度由外层标签容器决定 (工作区 TabHost 提供 h-full); 不再自算视口高度。
    <div className="relative h-full w-full">
      {effectiveStatus === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载 {manifest.name}…
        </div>
      )}
      {effectiveStatus === "failed" && (
        // bg-background 盖住 iframe 可能露出的浏览器原生错误页
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
          <WifiOff className="h-8 w-8 text-muted-foreground" />
          <div className="text-sm font-medium">
            {online ? `${manifest.name}加载失败` : "当前处于离线状态"}
          </div>
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            {online
              ? "可能是服务暂时不可用。资讯 / 社区需要连接后端服务；本机的笔记、书签、资源不受影响。"
              : "连网后可重试。本机的笔记、书签、资源离线也能用。"}
          </p>
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            重试
          </Button>
        </div>
      )}
      <iframe
        key={reloadKey}
        ref={iframeRef}
        src={embedSrc ?? manifest.entry}
        title={manifest.name}
        onError={() => setStatus("failed")}
        // allow-same-origin: 被嵌入页需真实 origin (CORS 直连语料 + 宿主源校验); 隔膜靠跨域 + token 不出宿主, 非 sandbox。
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        className={cn(
          "h-full w-full border-0 bg-background",
          effectiveStatus !== "ready" && "invisible",
        )}
      />
    </div>
  )
}
