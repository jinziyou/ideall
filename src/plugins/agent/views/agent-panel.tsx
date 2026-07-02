"use client"

// AI 对话面板 (对话栏 / AI 标签共用): 状态与发送编排的所有者。
// 展示块已拆为纯组件: 线程列表 (agent-thread-list) / 输入区 + 工具确认条 (agent-composer);
// 消息气泡为 chat-message。本文件保留: 线程增删选、send() 两模式编排 (对话流式 / 智能体工具环)、
// 技能触发、工具执行确认的 promise 桥接。
import * as React from "react"
import { toast } from "sonner"
import { Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { getActiveNodeRef } from "@/lib/active-node"
import { Button } from "@/ui/button"
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
import AgentThreadList from "./agent-thread-list"
import AgentComposer, { ToolApprovalBar } from "./agent-composer"
import { Chip } from "./ui-kit"

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
        <AgentThreadList
          threads={shownThreads}
          activeId={activeId}
          newLabel={newLabel}
          emptyLabel={emptyLabel}
          onNew={newChat}
          onSelect={selectThread}
          onRemove={removeThread}
        />
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
          <ToolApprovalBar
            compact={compact}
            pending={pendingApproval}
            onDecide={(allow) =>
              setPendingApproval((p) => {
                p?.resolve(allow)
                return null
              })
            }
          />
        )}

        <AgentComposer
          compact={compact}
          configured={configured}
          sending={sending}
          streaming={streamingId !== null}
          agentMode={agentMode}
          onToggleAgentMode={() => setAgentMode((v) => !v)}
          skills={skills}
          onRunSkill={runSkill}
          input={input}
          onInputChange={setInput}
          onSend={() => send()}
          onStop={stop}
          onOpenSettings={openSettings}
          inputRef={inputRef}
        />
      </section>

      <AgentSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
})

export default AgentPanel
