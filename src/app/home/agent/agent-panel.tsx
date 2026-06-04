"use client"

import * as React from "react"
import { toast } from "sonner"
import { Bot, Loader2, Send, Settings, SquarePen, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { AgentMessage, AgentThread } from "../model"
import {
  createThread,
  deleteThread,
  getThread,
  listThreads,
  makeMessage,
  saveThread,
  titleFromMessage,
} from "../lib/agent-store"
import { getAgentSettings, isConfigured, subscribeAgentSettings } from "../lib/agent-settings"
import { buildSystemPrompt, gatherHomeContext } from "../lib/agent-context"
import { streamChat } from "../lib/agent-chat"
import ChatMessage from "./chat-message"
import AgentSettingsDialog from "./agent-settings-dialog"

// 发给模型的历史上限 (控制 token; 系统提示另算)
const HISTORY_LIMIT = 20

const SUGGESTIONS = [
  "根据我订阅的来源，最近值得关注什么？",
  "帮我把书签按主题归归类，给个方案",
  "我都收藏了哪些资源？帮我概括一下",
]

export default function AgentPanel() {
  const settings = React.useSyncExternalStore(
    subscribeAgentSettings,
    getAgentSettings,
    getAgentSettings,
  )
  const configured = isConfigured(settings)

  const [threads, setThreads] = React.useState<AgentThread[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<AgentMessage[]>([])
  const [input, setInput] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [streamingId, setStreamingId] = React.useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  const abortRef = React.useRef<AbortController | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  // 同步的发送中标志, 防止 sending 状态异步生效前的重入 (连按 Enter 创建孤儿线程)
  const sendingRef = React.useRef(false)

  const refreshThreads = React.useCallback(async () => {
    try {
      setThreads(await listThreads())
    } catch {
      /* 本地读取失败时静默 */
    }
  }, [])

  // 首次加载: 列出线程并打开最近一条
  React.useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const list = await listThreads()
        if (!alive) return
        setThreads(list)
        if (list.length > 0) {
          setActiveId(list[0].id)
          setMessages(list[0].messages)
        }
      } catch {
        /* 忽略 */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // 新消息时滚到底部
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  function newChat() {
    if (sending) return
    setActiveId(null)
    setMessages([])
    setInput("")
    inputRef.current?.focus()
  }

  async function selectThread(id: string) {
    if (sending || id === activeId) return
    try {
      const t = await getThread(id)
      if (t) {
        setActiveId(id)
        setMessages(t.messages)
      }
    } catch {
      /* 忽略 */
    }
  }

  async function removeThread(id: string) {
    if (sendingRef.current) return
    try {
      await deleteThread(id)
    } catch {
      /* 忽略 */
    }
    if (id === activeId) {
      setActiveId(null)
      setMessages([])
    }
    refreshThreads()
  }

  function stop() {
    abortRef.current?.abort()
  }

  async function send() {
    const text = input.trim()
    if (!text || sendingRef.current) return
    const cfg = getAgentSettings()
    if (!isConfigured(cfg)) {
      toast.error("请先在设置中填写 API Key")
      setSettingsOpen(true)
      return
    }
    sendingRef.current = true

    setInput("")
    const userMsg = makeMessage("user", text)
    const convo = [...messages, userMsg]
    setMessages(convo)

    // 确保线程存在并落库 (含本条用户消息)
    let thread: AgentThread
    try {
      if (!activeId) {
        const created = await createThread()
        thread = { ...created, title: titleFromMessage(text), messages: convo }
      } else {
        const existing = await getThread(activeId)
        thread = existing
          ? { ...existing, messages: convo }
          : { ...(await createThread()), title: titleFromMessage(text), messages: convo }
      }
      await saveThread(thread)
      setActiveId(thread.id)
      refreshThreads()
    } catch (e) {
      toast.error("无法保存对话", { description: String(e) })
      sendingRef.current = false
      return
    }

    // 组装发送给模型的消息: 系统提示 (可选 home 上下文) + 截断后的历史
    let system = ""
    try {
      const ctx = cfg.includeHomeContext ? await gatherHomeContext() : ""
      system = buildSystemPrompt(ctx)
    } catch {
      system = buildSystemPrompt("")
    }
    const apiMessages = [
      { role: "system", content: system },
      ...convo.slice(-HISTORY_LIMIT).map((m) => ({ role: m.role, content: m.content })),
    ]

    // 助手占位消息, 流式填充
    const asst = makeMessage("assistant", "")
    setMessages((prev) => [...prev, asst])
    setStreamingId(asst.id)
    setSending(true)
    const controller = new AbortController()
    abortRef.current = controller

    let acc = ""
    try {
      await streamChat({
        baseURL: cfg.baseURL,
        model: cfg.model,
        apiKey: cfg.apiKey,
        messages: apiMessages,
        signal: controller.signal,
        onDelta: (d) => {
          acc += d
          setMessages((prev) => prev.map((m) => (m.id === asst.id ? { ...m, content: acc } : m)))
        },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error("对话出错", { description: msg })
      if (!acc) acc = `（请求出错：${msg}）`
      setMessages((prev) => prev.map((m) => (m.id === asst.id ? { ...m, content: acc } : m)))
    } finally {
      setSending(false)
      setStreamingId(null)
      abortRef.current = null
    }

    // 落库最终对话
    try {
      const finalMsgs = [...convo, { ...asst, content: acc }]
      await saveThread({ ...thread, messages: finalMsgs })
      refreshThreads()
    } catch {
      /* 落库失败不阻塞 UI */
    } finally {
      sendingRef.current = false
    }
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      {/* 会话侧栏 */}
      <aside className="md:w-52 md:shrink-0">
        <Button variant="outline" size="sm" className="mb-2 w-full justify-start gap-2" onClick={newChat}>
          <SquarePen className="h-4 w-4" />
          新对话
        </Button>
        <div className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {threads.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">还没有对话</p>
          )}
          {threads.map((t) => {
            const active = t.id === activeId
            return (
              <div
                key={t.id}
                className={cn(
                  "group flex shrink-0 items-center gap-1 rounded-md pl-3 pr-1 text-sm transition-colors md:shrink",
                  active ? "bg-accent font-medium" : "hover:bg-accent/60",
                )}
              >
                <button
                  className="flex-1 truncate py-2 text-left"
                  title={t.title}
                  onClick={() => selectThread(t.id)}
                >
                  {t.title}
                </button>
                <button
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  title="删除对话"
                  onClick={() => removeThread(t.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </aside>

      {/* 对话区 */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Bot className="h-5 w-5 text-primary" />
              AI 助手
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              懂你的 home —— 结合订阅 / 书签 / 资源作答，对话只存本机
            </p>
          </div>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4" />
            设置
          </Button>
        </div>

        {!configured && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
            <span>尚未配置模型。请填写你的 API Key（默认 DeepSeek，仅存本机）。</span>
            <Button size="sm" onClick={() => setSettingsOpen(true)}>
              去设置
            </Button>
          </div>
        )}

        <div
          ref={scrollRef}
          className="flex h-[calc(100vh-19rem)] min-h-[20rem] flex-col gap-4 overflow-y-auto rounded-lg border bg-background/40 p-4"
        >
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">问问关于你 home 的事</p>
                <p className="text-sm text-muted-foreground">助手会结合你的订阅、书签与资源作答</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => {
                      setInput(s)
                      inputRef.current?.focus()
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <ChatMessage key={m.id} message={m} streaming={m.id === streamingId} />
            ))
          )}
        </div>

        {/* 输入区 */}
        <div className="mt-3 flex items-end gap-2">
          <Textarea
            ref={inputRef}
            rows={2}
            value={input}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            className="max-h-40 min-h-[2.75rem] resize-none"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onComposerKeyDown}
          />
          {sending ? (
            <Button variant="outline" className="gap-1.5" onClick={stop}>
              <X className="h-4 w-4" />
              停止
            </Button>
          ) : (
            <Button className="gap-1.5" onClick={send} disabled={!input.trim()}>
              {streamingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              发送
            </Button>
          )}
        </div>
      </section>

      <AgentSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
