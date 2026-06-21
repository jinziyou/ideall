"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { MessagePortTransport } from "./transport"
import { registerGrantedResources, registerGrantedTools } from "./tools"
import { HELLO_MESSAGE_TYPE, INIT_MESSAGE_TYPE, PROTOCOL_VERSION, type ThemeTokens } from "./protocol"
import type { Manifest } from "./manifest"

function currentTheme(): ThemeTokens {
  const dark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  return { mode: dark ? "dark" : "light" }
}

/**
 * EmbedHost —— 宿主壳: 把一个嵌入应用 (manifest) 以 iframe + postMessage + MCP 内嵌进 ideall。
 *  - 握手: iframe 'load' 或 收到页面 hello (取先到者) → 建两条 MessageChannel → 转移 port2 + 发 ideall:init。
 *  - 能力面: 起 McpServer, 只注册 manifest 授权的 tool/resource, 经 mcpPort 通信。
 *  - UI 面: uiPort 推送主题 (初始 + 变更) / 接收页面 ready 撤 loading。
 *  - 卸载: 关闭 server 与端口, 断开观察器。
 */
export function EmbedHost({ manifest }: { manifest: Manifest }) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const router = useRouter()
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    let entryOrigin: string
    try {
      entryOrigin = new URL(manifest.entry).origin
    } catch {
      console.error("[EmbedHost] manifest.entry 非法 URL:", manifest.entry)
      return
    }
    // 一致性断言: entry 源必须在 manifest.origins 白名单内 (防 env 错配下向非预期源发 init)。
    if (manifest.origins.length > 0 && !manifest.origins.includes(entryOrigin)) {
      console.error(
        `[EmbedHost] entry 源 ${entryOrigin} 不在 manifest.origins ${JSON.stringify(manifest.origins)} 内, 已中止 (检查 NEXT_PUBLIC_EMBED_BASE)。`,
      )
      return
    }

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
      const server = new McpServer({ name: "ideall-host", version: "1.0.0" })
      registerGrantedResources(server, manifest.permissions)
      registerGrantedTools(server, manifest.permissions, { navigate: (r) => router.push(r) })
      void server.connect(new MessagePortTransport(mcp.port1))

      // UI 面 (uiPort): 接收页面事件 + 推送主题。
      const uiPort = ui.port1
      uiPort.onmessage = (e: MessageEvent) => {
        const msg = e.data as { type?: string } | undefined
        if (msg?.type === "ready") setReady(true)
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

    // 路径 1: iframe 'load' 后宿主主动发 init。
    const onLoad = () => startBridge()
    iframe.addEventListener("load", onLoad)

    // 路径 2: 页面 hello (主动索取 init) —— 消除 'load' 时序竞争。须校验来源与 source。
    const onHello = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return
      if (e.origin !== entryOrigin) return
      if ((e.data as { type?: string } | undefined)?.type !== HELLO_MESSAGE_TYPE) return
      startBridge()
    }
    window.addEventListener("message", onHello)

    return () => {
      iframe.removeEventListener("load", onLoad)
      window.removeEventListener("message", onHello)
      cleanups.forEach((f) => f())
    }
  }, [manifest, router])

  return (
    <div className="relative h-[calc(100dvh-3.5rem)] w-full">
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载 {manifest.name}…
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={manifest.entry}
        title={manifest.name}
        // allow-same-origin: 被嵌入页需真实 origin (CORS 直连语料 + 宿主源校验); 隔膜靠跨域 + token 不出宿主, 非 sandbox。
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        className="h-full w-full border-0 bg-background"
      />
    </div>
  )
}
