"use client"

import * as React from "react"
import { toast } from "sonner"
import { Bot, Loader2, Send, Settings, Sparkles, SquarePen, Trash2, Wrench, X } from "lucide-react"
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
import { ServiceHeader } from "@/shared/service-header"
import { BUILTIN_SKILLS, type AgentSkill } from "../lib/agent-skills"
import type { AgentMessage, AgentThread, AgentToolEvent } from "../lib/model"
import type { ConnectAgentOpts } from "../lib/agent-mcp"
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

// 发给模型的历史上限 (控制 token; 系统提示另算)
const HISTORY_LIMIT = 20

const SUGGESTIONS = [
  "根据我关注的来源，最近值得关注什么？",
  "帮我把书签按主题归归类，给个方案",
  "我都收藏了哪些资源？帮我概括一下",
]

/** 一次运行解析出的连接 + 已组装系统提示 + 能力收窄 (工作区 / 精确模式在此注入)。 */
export interface ResolvedRun {
  baseURL: string
  model: string
  apiKey: string
  /** 已组装好的系统提示 (工作区 / 精确模式在此给出最终文本)。 */
  system: string
  /** 工作区能力收窄 (传给 runAgent → connectAgentMcp)。 */
  mcp?: ConnectAgentOpts
}

export interface AgentPanelProps {
  compact?: boolean
  /** 工作区注入: 决定模型 / 系统提示 / 能力 (精确模式在此覆盖)。缺省 = 右栏默认行为 (全局设置 + 默认拼装)。 */
  resolveRun?: (useAgent: boolean) => Promise<ResolvedRun | null>
  /** 配置态 (false → 显示未配置 banner / 拦截发送)。缺省取全局 isConfigured。 */
  configured?: boolean
  /** 模型名 (状态栏展示)。缺省取全局 settings.model。 */
  modelLabel?: string
  /** 技能列表 (工作区可筛选)。缺省 = 全部内置技能。 */
  skills?: AgentSkill[]
  /** 设置入口点击 (工作区改为打开模型组面板)。缺省打开内置全局设置 Dialog。 */
  onOpenSettings?: () => void
}

export default function AgentPanel({
  compact = false,
  resolveRun,
  configured: configuredProp,
  modelLabel,
  skills = BUILTIN_SKILLS,
  onOpenSettings,
}: AgentPanelProps = {}) {
  const settings = React.useSyncExternalStore(
    subscribeAgentSettings,
    getAgentSettings,
    getAgentSettings,
  )
  const configured = configuredProp ?? isConfigured(settings)

  const [threads, setThreads] = React.useState<AgentThread[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<AgentMessage[]>([])
  const [input, setInput] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [streamingId, setStreamingId] = React.useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  // 智能体模式: 开启后模型可调用工具读写 home 数据 (非流式); 默认关 (普通流式对话)
  const [agentMode, setAgentMode] = React.useState(false)

  const abortRef = React.useRef<AbortController | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  // 同步的发送中标志, 防止 sending 状态异步生效前的重入 (连按 Enter 创建孤儿线程)
  const sendingRef = React.useRef(false)
  // 输入法 (IME) 组合中标志: Tauri 的 WebKitGTK webview 下 keydown 的 isComposing 不可靠 (组合中常为 false),
  // 仅凭它会让中文选词/确认候选的 Enter 被误判为发送、打断组合 → 改用 compositionstart/end 维护此 ref 兜底。
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
    // 用同步 sendingRef (与 removeThread 一致): send() 进入后立即置位、setSending 要等 await 后才生效,
    // 用异步 state sending 守卫会留出窗口让本函数在发送途中切走线程, 使消息落入错误线程。
    if (sendingRef.current) return
    setActiveId(null)
    setMessages([])
    setInput("")
    inputRef.current?.focus()
  }

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
    abortRef.current?.abort()
  }

  async function send(override?: string, opts?: { agentMode?: boolean }) {
    // override: 技能等非输入框来源的预置文本; 缺省仍取输入框。useAgent: 技能可临时强制智能体模式
    // (绕开 setAgentMode 异步 state 同 tick 读不到的问题)。
    const text = (override ?? input).trim()
    if (!text || sendingRef.current) return
    const useAgent = opts?.agentMode ?? agentMode
    if (!configured) {
      toast.error("请先配置模型（API Key）")
      openSettings()
      return
    }
    sendingRef.current = true

    if (override === undefined) setInput("") // 技能触发不清空用户已输入的草稿
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

    // 解析本次运行: 工作区经 resolveRun 注入 (模型 + 系统提示 + 能力收窄, 含精确模式覆盖);
    // 右栏默认行为 = 全局设置 + 默认拼装 (可选 home 上下文 + 是否开放工具)。
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
          // 对话即文件 (§6.5): 注入用户当前正在看的 note 正文 / thread 会话 (随 home 上下文开关)。
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

    // 助手占位消息
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
        // 智能体: 工具调用循环 (非流式), 工具事件实时回填到该助手消息
        const res = await runAgent({
          baseURL: runCfg.baseURL,
          model: runCfg.model,
          apiKey: runCfg.apiKey,
          messages: apiMessages,
          signal: controller.signal,
          mcp: runCfg.mcp,
          onToolEvent: (ev) => {
            toolEvents = [...toolEvents, ev]
            setMessages((prev) => prev.map((m) => (m.id === asst.id ? { ...m, toolEvents } : m)))
          },
        })
        acc = res.content
        toolEvents = res.toolEvents
      } else {
        // 普通对话: 流式
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
      // 智能体中止会抛 AbortError —— 视为「停止」, 保留已生成内容, 不报错。
      if (!(e instanceof DOMException && e.name === "AbortError") && !controller.signal.aborted) {
        const msg = e instanceof Error ? e.message : String(e)
        toast.error(useAgent ? "智能体出错" : "对话出错", { description: msg })
        if (!acc) acc = `（请求出错：${msg}）`
      }
    } finally {
      // 智能体若没产出文本 (纯工具轮 / 中途停止), 用工具结果合成一句, 避免空助手消息
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

    // 落库最终对话
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
    // 组合中 (拼音选词 / 确认候选) 的 Enter 不应发送; isComposing 在 WebKitGTK 不可靠, 叠加 composingRef 兜底。
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !composingRef.current) {
      e.preventDefault()
      send()
    }
  }

  // 技能 = 一条预置提示, 点选即执行 (而非只预填)。needsActiveNode 类先校验当前节点 + 数据上下文开关。
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
      // 右栏默认行为下校验「带上我的数据」开关; 工作区由 resolveRun 自管数据注入, 此处不拦。
      if (!resolveRun && !getAgentSettings().includeHomeContext) {
        toast.error("请在设置中开启「带上我的数据」，技能才能读到当前内容")
        return
      }
    }
    void send(skill.prompt, { agentMode: skill.agentMode })
  }

  return (
    <div className="flex h-full flex-col gap-4 md:flex-row">
      {/* 会话侧栏 (紧凑模式隐藏, 新对话改在标题栏) */}
      {!compact && (
        <aside className="md:w-52 md:shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="mb-2 w-full justify-start gap-2"
            onClick={newChat}
          >
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
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                    title="删除对话"
                    onClick={() => removeThread(t.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">删除对话</span>
                  </button>
                </div>
              )
            })}
          </div>
        </aside>
      )}

      {/* 对话区 */}
      <section className="mx-auto flex h-full w-full min-w-0 max-w-4xl flex-1 flex-col">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <ServiceHeader
              icon={Bot}
              title="AI 助手"
              status={
                configured
                  ? { label: `就绪 · ${modelLabel ?? settings.model}`, tone: "ok" }
                  : { label: "未配置模型", tone: "warn" }
              }
            />
            <p className="mt-1 truncate text-xs text-muted-foreground">懂「我的」，对话只存本机</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {compact && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={newChat}
                title="新对话"
              >
                <SquarePen className="h-4 w-4" />
                <span className="sr-only">新对话</span>
              </Button>
            )}
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={openSettings}>
              <Settings className="h-4 w-4" />
              设置
            </Button>
          </div>
        </div>

        {!configured && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-l-2 border-l-pop bg-muted/40 px-4 py-3 text-sm">
            <span>填入你的 API Key 开始使用，密钥只存本机。</span>
            <Button size="sm" onClick={openSettings}>
              去设置
            </Button>
          </div>
        )}

        <div
          ref={scrollRef}
          // aria-live=polite + aria-busy: 流式中 (streamingId 非空) busy=true 抑制逐 token 播报,
          // 收尾 busy 转 false 时读屏一次性播报终态 —— 避免每 token 打断/重排队的过度播报。
          aria-live="polite"
          aria-busy={streamingId !== null}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-lg border bg-background/40 p-4"
        >
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">问问关于「我的」的事</p>
                <p className="text-sm text-muted-foreground">结合本机的关注、书签、资源作答</p>
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
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAgentMode((v) => !v)}
              disabled={sending}
              title="开启后助手可读写「我的」的数据"
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50",
                agentMode
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              <Wrench className="h-3.5 w-3.5" />
              智能体模式
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={sending}
                  title="一键技能：用预置提示 + 当前上下文跑助手"
                  className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
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
            {agentMode && (
              <span className="text-xs text-muted-foreground">助手可读写你的关注、书签、资源</span>
            )}
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              rows={2}
              value={input}
              placeholder={
                agentMode
                  ? "让助手整理本机的关注、书签、资源…（Enter 发送）"
                  : "输入消息，Enter 发送，Shift+Enter 换行"
              }
              className="max-h-40 min-h-[2.75rem] resize-none"
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
              <Button variant="outline" className="gap-1.5" onClick={stop}>
                <X className="h-4 w-4" />
                停止
              </Button>
            ) : (
              <Button className="gap-1.5" onClick={() => send()} disabled={!input.trim()}>
                {streamingId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                发送
              </Button>
            )}
          </div>
        </div>
      </section>

      <AgentSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
