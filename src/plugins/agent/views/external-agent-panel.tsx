"use client"

// 客户端方向 UI (Stage 1) —— 在 ideall 内驱动【外部 ACP 智能体】(claude-code-acp / gemini --acp 等)。
// 经 connectExternalAcpAgent 连一个用户配置的外部 agent 子进程; prompt→stop 一轮里的 session/update 经
// 纯折叠器 (acp-chat) 折成助手消息 (文本 + 工具事件), 复用 ChatMessage 渲染。仅 App 桌面可用。
// 注: 这是独立面板, 与本机模型的 AgentPanel 并列 (互不影响); 端到端需真实外部 agent 联调。
import * as React from "react"
import { toast } from "sonner"
import { Bot, Loader2, Plug, Send, Unplug, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { Button } from "@/ui/button"
import { Textarea } from "@/ui/textarea"
import type { AgentMessage } from "../lib/model"
import ChatMessage from "./chat-message"
import AgentSettingsDialog from "./agent-settings-dialog"
import { getAcpSettings } from "../lib/acp/acp-settings"
import { connectExternalAcpAgent, type ExternalAcpHandle } from "../lib/acp/acp-client"
import {
  EMPTY_TURN,
  foldAcpUpdate,
  pickPermissionOption,
  turnToolEvents,
  type AcpTurnState,
} from "../lib/acp/acp-chat"

let msgSeq = 0
function mkMsg(role: "user" | "assistant", content: string): AgentMessage {
  return { id: `ext-${Date.now()}-${msgSeq++}`, role, content, createdAt: Date.now() }
}

export default function ExternalAgentPanel({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [messages, setMessages] = React.useState<AgentMessage[]>([])
  const [input, setInput] = React.useState("")
  const [connected, setConnected] = React.useState(false)
  const [connecting, setConnecting] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  // 流式中的助手消息 id (render 用 state, 不在 render 读 ref)。
  const [streamingId, setStreamingId] = React.useState<string | null>(null)
  const openSettings = onOpenSettings ?? (() => setSettingsOpen(true))

  const handleRef = React.useRef<ExternalAcpHandle | null>(null)
  // 当前在流式接收的一轮: 累积 + 对应助手消息 id (回调闭包经 ref 取最新)。
  const turnRef = React.useRef<{ acc: AcpTurnState; asstId: string | null }>({
    acc: EMPTY_TURN,
    asstId: null,
  })
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const composingRef = React.useRef(false)

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  // 卸载时断开 (杀子进程)。
  React.useEffect(() => {
    return () => {
      void handleRef.current?.close()
      handleRef.current = null
    }
  }, [])

  async function connect() {
    if (connecting || connected) return
    const cfg = getAcpSettings().externalAgent
    if (!cfg.program.trim()) {
      toast.error("请先在设置里配置外部智能体命令")
      openSettings()
      return
    }
    if (!isTauri()) {
      toast.error("外部智能体仅 App 桌面可用")
      return
    }
    setConnecting(true)
    try {
      const h = await connectExternalAcpAgent({
        program: cfg.program.trim(),
        args: cfg.args.split(/\s+/).filter(Boolean),
        cwd: cfg.cwd.trim() || ".",
        onUpdate: (n) => {
          const t = turnRef.current
          t.acc = foldAcpUpdate(t.acc, n.update)
          if (!t.asstId) return
          const content = t.acc.text
          const toolEvents = turnToolEvents(t.acc)
          setMessages((prev) =>
            prev.map((m) => (m.id === t.asstId ? { ...m, content, toolEvents } : m)),
          )
        },
        onTurnEnd: () => {
          const t = turnRef.current
          if (t.asstId && !t.acc.text.trim() && t.acc.tools.length === 0) {
            const id = t.asstId
            setMessages((prev) =>
              prev.map((m) => (m.id === id ? { ...m, content: "（外部智能体没有返回内容）" } : m)),
            )
          }
          t.asstId = null
          setBusy(false)
          setStreamingId(null)
        },
        requestPermission: (req) => {
          const allow =
            typeof window !== "undefined" &&
            window.confirm(`外部智能体请求执行：${req.toolCall.title ?? "操作"}\n\n允许？`)
          const opt = pickPermissionOption(req.options, allow)
          return Promise.resolve(
            opt
              ? { outcome: { outcome: "selected", optionId: opt.optionId } }
              : { outcome: { outcome: "cancelled" } },
          )
        },
      })
      handleRef.current = h
      setConnected(true)
      toast.success("已连接外部智能体")
      // 子进程退出 / 连接收束 → 标记断开。
      void h.done.then(() => {
        if (handleRef.current === h) {
          handleRef.current = null
          setConnected(false)
          setBusy(false)
          setStreamingId(null)
        }
      })
    } catch (e) {
      toast.error("连接失败：" + (e instanceof Error ? e.message : String(e)))
    } finally {
      setConnecting(false)
    }
  }

  async function disconnect() {
    const h = handleRef.current
    handleRef.current = null
    setConnected(false)
    setBusy(false)
    setStreamingId(null)
    if (h) await h.close()
  }

  function send() {
    const text = input.trim()
    if (!text || busy) return
    const h = handleRef.current
    if (!h) {
      toast.error("请先连接外部智能体")
      return
    }
    setInput("")
    const userMsg = mkMsg("user", text)
    const asst = mkMsg("assistant", "")
    setMessages((prev) => [...prev, userMsg, asst])
    turnRef.current = { acc: EMPTY_TURN, asstId: asst.id }
    setBusy(true)
    setStreamingId(asst.id)
    h.prompt(text)
  }

  function stop() {
    handleRef.current?.cancel()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !composingRef.current) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="mx-auto flex h-full w-full min-w-0 max-w-4xl flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">外部智能体</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs",
              connected ? "bg-pop/10 text-pop" : "bg-muted text-muted-foreground",
            )}
          >
            {connected ? "已连接" : "未连接"}
          </span>
        </div>
        {connected ? (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void disconnect()}>
            <Unplug className="h-4 w-4" />
            断开
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={connecting}
            onClick={() => void connect()}
          >
            {connecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plug className="h-4 w-4" />
            )}
            连接
          </Button>
        )}
      </div>

      <div
        ref={scrollRef}
        aria-live="polite"
        aria-busy={busy}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-lg border bg-background/40 p-4"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">驱动外部 ACP 智能体</p>
              <p className="text-sm text-muted-foreground">
                在设置里配置命令（如 claude-code-acp、gemini --acp），连接后即可对话。仅桌面 App。
              </p>
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <ChatMessage key={m.id} message={m} streaming={m.id === streamingId} />
          ))
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <Textarea
          rows={2}
          value={input}
          placeholder={connected ? "给外部智能体下指令，Enter 发送" : "先点「连接」"}
          disabled={!connected}
          className="max-h-40 min-h-[2.75rem] resize-none"
          onChange={(e) => setInput(e.target.value)}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <Button variant="outline" className="gap-1.5" onClick={stop}>
            <X className="h-4 w-4" />
            停止
          </Button>
        ) : (
          <Button className="gap-1.5" onClick={send} disabled={!connected || !input.trim()}>
            <Send className="h-4 w-4" />
            发送
          </Button>
        )}
      </div>

      <AgentSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
