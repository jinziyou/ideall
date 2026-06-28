"use client"

import * as React from "react"
import { toast } from "sonner"
import { Loader2, Plus, Send, Settings, Sparkles, Trash2, Wrench, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { getActiveNodeRef } from "@/lib/active-node"
import { Button } from "@/ui/button"
import { Textarea } from "@/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { BUILTIN_SKILLS, type AgentSkill } from "../lib/agent-skills"
import type { AgentMessage, AgentThread, AgentToolEvent } from "../lib/model"
import type { ResolvedRun } from "../lib/agent-resolve"
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
import { buildSystemPrompt, gatherHomeContext, gatherReferencedContext } from "../lib/agent-context"
import { streamChat } from "../lib/agent-chat"
import { runAgent } from "../lib/agent-run"
import ChatMessage from "./chat-message"
import AgentSettingsDialog from "./agent-settings-dialog"
import { Chip, ComposerShell } from "./ui-kit"

const HISTORY_LIMIT = 20

export type { ResolvedRun }

export interface AgentPanelHandle {
  newChat: () => void
}

export interface AgentPanelProps {
  compact?: boolean
  resolveRun?: (useAgent: boolean) => Promise<ResolvedRun | null>
  configured?: boolean
  modelLabel?: string
  skills?: AgentSkill[]
  onOpenSettings?: () => void
  scopeIds?: string[]
  onThreadCreated?: (id: string) => void
  newLabel?: string
  emptyLabel?: string
}

const AgentPanel = React.forwardRef<AgentPanelHandle, AgentPanelProps>(function AgentPanel(
  {
    compact = false,
    resolveRun,
    configured: configuredProp,
    modelLabel,
    skills = BUILTIN_SKILLS,
    onOpenSettings,
    scopeIds,
    onThreadCreated,
    newLabel = "新对话",
    emptyLabel = "还没有对话",
  }: AgentPanelProps = {},
  ref,
) {
  const settings = React.useSyncExternalStore(
    subscribeAgentSettings,
    getAgentSettings,
    getAgentSettings,
  )
  const configured = configuredProp ?? isConfigured(settings)
  const showHeader = !compact && scopeIds === undefined

  const [threads, setThreads] = React.useState<AgentThread[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<AgentMessage[]>([])
  const [input, setInput] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [streamingId, setStreamingId] = React.useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [agentMode, setAgentMode] = React.useState(false)
  const [pendingApproval, setPendingApproval] = React.useState<{
    name: string
    argsText: string
    resolve: (v: boolean) => void
  } | null>(null)

  const approveTool = React.useCallback(
    (name: string, argsText: string) =>
      new Promise<boolean>((resolve) => setPendingApproval({ name, argsText, resolve })),
    [],
  )

  const abortRef = React.useRef<AbortController | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const sendingRef = React.useRef(false)
  const composingRef = React.useRef(false)

  function openSettings() {
    if (onOpenSettings) onOpenSettings()
    else setSettingsOpen(true)
  }

  const refreshThreads = React.useCallback(async () => {
    try {
      setThreads(await listThreads())
    } catch {
      /* 本地读取失败时静默 */
    }
  }, [])

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

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  function newChat() {
    if (sendingRef.current) return
    setActiveId(null)
    setMessages([])
    setInput("")
    inputRef.current?.focus()
  }

  React.useImperativeHandle(ref, () => ({ newChat }), [])

  async function selectThread(id: string) {
    if (sendingRef.current || id === activeId) return
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
    setPendingApproval((p) => {
      p?.resolve(false)
      return null
    })
    abortRef.current?.abort()
  }

  async function send(override?: string, opts?: { agentMode?: boolean }) {
    const text = (override ?? input).trim()
    if (!text || sendingRef.current) return
    const useAgent = opts?.agentMode ?? agentMode
    if (!configured) {
      toast.error("请先配置模型（API Key）")
      openSettings()
      return
    }
    sendingRef.current = true

    if (override === undefined) setInput("")
    const userMsg = makeMessage("user", text)
    const convo = [...messages, userMsg]
    setMessages(convo)

    let thread: AgentThread
    let createdNew = false
    try {
      if (!activeId) {
        const created = await createThread()
        createdNew = true
        thread = { ...created, title: titleFromMessage(text), messages: convo }
      } else {
        const existing = await getThread(activeId)
        if (existing) {
          thread = { ...existing, messages: convo }
        } else {
          createdNew = true
          thread = { ...(await createThread()), title: titleFromMessage(text), messages: convo }
        }
      }
      await saveThread(thread)
      setActiveId(thread.id)
      if (createdNew) onThreadCreated?.(thread.id)
      refreshThreads()
    } catch (e) {
      toast.error("无法保存对话", { description: String(e) })
      sendingRef.current = false
      return
    }

    let runCfg: ResolvedRun
    try {
      if (resolveRun) {
        const r = await resolveRun(useAgent)
        if (!r) {
          toast.error("请先配置模型（API Key）")
          openSettings()
          sendingRef.current = false
          return
        }
        runCfg = r
      } else {
        const cfg = getAgentSettings()
        let system = ""
        try {
          const ctx = cfg.includeHomeContext ? await gatherHomeContext() : ""
          const referenced = cfg.includeHomeContext ? await gatherReferencedContext() : ""
          system = buildSystemPrompt(ctx, { tools: useAgent, referenced })
        } catch {
          system = buildSystemPrompt("", { tools: useAgent })
        }
        runCfg = { baseURL: cfg.baseURL, model: cfg.model, apiKey: cfg.apiKey, system }
      }
    } catch (e) {
      toast.error("无法准备发送", { description: String(e) })
      sendingRef.current = false
      return
    }

    const apiMessages = [
      { role: "system", content: runCfg.system },
      ...convo.slice(-HISTORY_LIMIT).map((m) => ({ role: m.role, content: m.content })),
    ]

    const asst = makeMessage("assistant", "")
    setMessages((prev) => [...prev, asst])
    setStreamingId(asst.id)
    setSending(true)
    const controller = new AbortController()
    abortRef.current = controller

    let acc = ""
    let toolEvents: AgentToolEvent[] = []
    try {
      if (useAgent) {
        const res = await runAgent({
          baseURL: runCfg.baseURL,
          model: runCfg.model,
          apiKey: runCfg.apiKey,
          messages: apiMessages,
          signal: controller.signal,
          mcp: runCfg.mcp,
          onApprove: settings.approvalPolicy === "confirm" ? approveTool : undefined,
          onToolEvent: (ev) => {
            toolEvents = [...toolEvents, ev]
            setMessages((prev) => prev.map((m) => (m.id === asst.id ? { ...m, toolEvents } : m)))
          },
        })
        acc = res.content
        toolEvents = res.toolEvents
      } else {
        await streamChat({
          baseURL: runCfg.baseURL,
          model: runCfg.model,
          apiKey: runCfg.apiKey,
          messages: apiMessages,
          signal: controller.signal,
          onDelta: (d) => {
            acc += d
            setMessages((prev) => prev.map((m) => (m.id === asst.id ? { ...m, content: acc } : m)))
          },
        })
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError") && !controller.signal.aborted) {
        const msg = e instanceof Error ? e.message : String(e)
        toast.error(useAgent ? "智能体出错" : "对话出错", { description: msg })
        if (!acc) acc = `（请求出错：${msg}）`
      }
    } finally {
      if (useAgent && !acc.trim()) {
        acc = toolEvents.length
          ? `已执行 ${toolEvents.length} 个操作：${toolEvents.map((t) => t.summary).join("；")}`
          : "（助手没有返回内容）"
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === asst.id ? { ...m, content: acc, toolEvents } : m)),
      )
      setSending(false)
      setStreamingId(null)
      abortRef.current = null
    }

    try {
      const finalAsst: AgentMessage = {
        ...asst,
        content: acc,
        ...(toolEvents.length ? { toolEvents } : {}),
      }
      await saveThread({ ...thread, messages: [...convo, finalAsst] })
      refreshThreads()
    } catch {
      /* 落库失败不阻塞 UI */
    } finally {
      sendingRef.current = false
    }
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !composingRef.current) {
      e.preventDefault()
      send()
    }
  }

  function runSkill(skill: AgentSkill) {
    if (sendingRef.current) return
    if (!configured) {
      toast.error("请先配置模型（API Key）")
      openSettings()
      return
    }
    if (skill.needsActiveNode) {
      if (!getActiveNodeRef()) {
        toast.error("请先打开一篇笔记或一段对话，技能才能读到当前内容")
        return
      }
      if (!resolveRun && !getAgentSettings().includeHomeContext) {
        toast.error("请在设置中开启「带上我的数据」，技能才能读到当前内容")
        return
      }
    }
    void send(skill.prompt, { agentMode: skill.agentMode })
  }

  const shownThreads = scopeIds
    ? threads.filter((t) => scopeIds.includes(t.id) || t.id === activeId)
    : threads

  const statusLabel = configured ? (modelLabel ?? settings.model) : "未配置模型"

  return (
    <div className={cn("flex h-full min-h-0", !compact && "md:gap-6")}>
      {!compact && (
        <aside className="flex w-48 shrink-0 flex-col md:w-52">
          <button
            type="button"
            onClick={newChat}
            className="mb-3 inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent"
          >
            <Plus className="h-4 w-4" />
            {newLabel}
          </button>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {shownThreads.length === 0 && (
              <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">
                {emptyLabel}
              </p>
            )}
            {shownThreads.map((t) => {
              const active = t.id === activeId
              return (
                <div
                  key={t.id}
                  className={cn(
                    "group flex items-center gap-0.5 rounded-lg px-2 transition-colors",
                    active ? "bg-accent/70" : "hover:bg-accent/40",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate py-2 text-left text-sm"
                    title={t.title}
                    onClick={() => selectThread(t.id)}
                  >
                    {t.title}
                  </button>
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/80 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                    title="删除"
                    onClick={() => removeThread(t.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">删除</span>
                  </button>
                </div>
              )
            })}
          </div>
        </aside>
      )}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {showHeader && (
          <header className="mb-6 flex shrink-0 items-center justify-between gap-3 px-1">
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold leading-tight">AI 助手</h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Chip tone={configured ? "ok" : "warn"}>{statusLabel}</Chip>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={openSettings}
                title="设置"
              >
                <Settings className="h-4 w-4" />
                <span className="sr-only">设置</span>
              </Button>
            </div>
          </header>
        )}

        {!compact && !configured && (
          <div className="mb-6 flex justify-end">
            <Button size="sm" variant="outline" onClick={openSettings}>
              去设置
            </Button>
          </div>
        )}

        <div
          ref={scrollRef}
          aria-live="polite"
          aria-busy={streamingId !== null}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div
            className={cn(
              "mx-auto flex w-full flex-col",
              compact ? "gap-5 px-4 py-6" : "max-w-2xl gap-6 py-2",
            )}
          >
            {messages.length === 0
              ? null
              : messages.map((m) => (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    streaming={m.id === streamingId}
                    compact={compact}
                  />
                ))}
          </div>
        </div>

        {pendingApproval && (
          <div className={cn("shrink-0", compact ? "px-4 pb-3" : "mt-4")}>
            <ComposerShell className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 text-[13px]">
                <span className="font-medium">请求执行工具</span>
                <span className="ml-1 font-mono text-muted-foreground">
                  {pendingApproval.name}
                  {pendingApproval.argsText ? `(${pendingApproval.argsText})` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setPendingApproval((p) => {
                      p?.resolve(false)
                      return null
                    })
                  }
                >
                  拒绝
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    setPendingApproval((p) => {
                      p?.resolve(true)
                      return null
                    })
                  }
                >
                  允许
                </Button>
              </span>
            </ComposerShell>
          </div>
        )}

        <div
          className={cn(
            "shrink-0 space-y-3",
            compact ? "border-t bg-card px-4 py-4" : "mx-auto mt-6 w-full max-w-2xl",
          )}
        >
          {compact && !configured && (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={openSettings}>
                去配置
              </Button>
            </div>
          )}
          <ComposerShell className={cn("space-y-3", compact && "border-0 bg-transparent p-0")}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAgentMode((v) => !v)}
                disabled={sending}
                title="开启后助手可读写「我的」的数据"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] transition-colors disabled:opacity-50",
                  agentMode
                    ? "border-primary/30 bg-primary/5 text-primary"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                <Wrench className="h-3.5 w-3.5" />
                智能体
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={sending}
                    title="一键技能"
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    技能
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60">
                  {skills.length === 0 && (
                    <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                      本工作区未启用技能
                    </DropdownMenuItem>
                  )}
                  {skills.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      onSelect={() => runSkill(s)}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="text-sm">{s.label}</span>
                      <span className="text-xs text-muted-foreground">{s.hint}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-end gap-2 rounded-lg border bg-background px-3 py-2">
              <Textarea
                ref={inputRef}
                rows={compact ? 3 : 2}
                value={input}
                placeholder={
                  !configured && compact
                    ? "配置 API Key 后即可对话…"
                    : agentMode
                      ? "让助手整理本机的关注、书签、资源…"
                      : "输入消息，Enter 发送，Shift+Enter 换行"
                }
                className="min-h-[2.75rem] max-h-40 flex-1 resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                onChange={(e) => setInput(e.target.value)}
                onCompositionStart={() => {
                  composingRef.current = true
                }}
                onCompositionEnd={() => {
                  composingRef.current = false
                }}
                onKeyDown={onComposerKeyDown}
              />
              {sending ? (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={stop}
                  title="停止"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">停止</span>
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => send()}
                  disabled={!input.trim()}
                  title="发送"
                >
                  {streamingId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  <span className="sr-only">发送</span>
                </Button>
              )}
            </div>
          </ComposerShell>
        </div>
      </section>

      <AgentSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
})

export default AgentPanel
