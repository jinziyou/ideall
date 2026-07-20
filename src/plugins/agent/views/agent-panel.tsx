"use client"

// AI 对话面板 (对话栏 / AI 标签共用): 状态与发送编排的所有者。
// 展示块已拆为纯组件: 线程列表 (agent-thread-list) / 输入区 + 工具确认条 (agent-composer);
// 消息气泡为 chat-message。本文件保留: 线程增删选、send() 两模式编排 (对话流式 / 智能体工具环)、
// 技能触发、工具执行确认的 promise 桥接。
import * as React from "react"
import { toast } from "sonner"
import { Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { getActiveNodeRef } from "@/lib/active-node"
import {
  addAgentContextSource,
  getAgentContextSources,
  nodeAgentContextSource,
  type AgentContextSource,
} from "@/lib/agent-context-tray"
import { getFilesPort } from "@protocol/files"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import { invokeFileAction } from "@/filesystem/registry"
import { Button } from "@/ui/button"
import { Chip } from "@/ui/chip"
import { BUILTIN_SKILLS, type AgentSkill } from "../lib/agent-skills"
import {
  saveAgentResponseAsNote,
  saveAgentResponseAsTask,
  saveAgentResponseToBookmarkDescription,
  undoAgentArtifact,
  type AgentBookmarkDescriptionDraft,
  type AgentNoteDraft,
  type AgentTaskArtifactDraft,
} from "../lib/agent-artifact"
import {
  isAgentArtifactReceipt,
  isUndoableAgentArtifact,
  type AgentArtifactReceipt,
  type AgentMessage,
  type AgentThread,
  type AgentToolEvent,
} from "../lib/model"
import type { ResolvedRun } from "../lib/agent-resolve"
import {
  createThread,
  getThread,
  listThreads,
  makeMessage,
  saveThread,
  titleFromMessage,
} from "../lib/agent-store"
import { deleteTaskOrThread } from "../agent-task-write-adapter"
import {
  getAgentSettings,
  hydrateAgentSettingsSecure,
  isConfigured,
  subscribeAgentSettings,
} from "../lib/agent-settings"
import { consumePendingOpenThread, onOpenThreadRequest } from "../lib/agent-panel-bus"
import { buildSystemPrompt, gatherHomeContext, gatherSelectedContext } from "../lib/agent-context"
import { streamChat } from "../lib/agent-chat"
import { runAgent } from "../lib/agent-run"
import { runExternalAcpAgent, type ExternalAcpMessage } from "../lib/acp/acp-client"
import {
  getAcpSettings,
  isExternalAcpConfigured,
  subscribeAcpSettings,
} from "../lib/acp/acp-settings"
import type { AgentToolPreview } from "../lib/agent-tool-preview"
import {
  appendAgentWriteAuditViaFileSystem,
  completeAgentWriteAuditViaFileSystem,
} from "../lib/agent-write-audit-client"
import ChatMessage from "./chat-message"
import AgentSettingsDialog from "./agent-settings-dialog"
import AgentThreadList from "./agent-thread-list"
import AgentComposer, { ToolApprovalBar } from "./agent-composer"
import AgentContextTray from "./agent-context-tray"

const HISTORY_LIMIT = 20
const ARTIFACT_ACTION_CONTEXT = { actor: "ui", permissions: [], intent: "action" } as const

function upsertArtifactReceipt(
  messages: readonly AgentMessage[],
  messageId: string,
  receipt: AgentArtifactReceipt,
): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message
    const current = Array.isArray(message.artifacts)
      ? message.artifacts.filter(isAgentArtifactReceipt)
      : []
    const index = current.findIndex(
      (artifact) => artifact.kind === receipt.kind && artifact.nodeId === receipt.nodeId,
    )
    return {
      ...message,
      artifacts:
        index < 0
          ? [...current, receipt]
          : current.map((artifact, artifactIndex) =>
              artifactIndex === index ? receipt : artifact,
            ),
    }
  })
}

export type { ResolvedRun }

export interface AgentPanelHandle {
  newChat: () => void
}

export interface AgentPanelProps {
  compact?: boolean
  resolveRun?: (useAgent: boolean, selectedContext: string) => Promise<ResolvedRun | null>
  configured?: boolean
  modelLabel?: string
  skills?: AgentSkill[]
  onOpenSettings?: () => void
  scopeIds?: string[]
  createScopedThread?: () => Promise<AgentThread>
  deleteScopedThread?: (id: string) => Promise<void>
  /** @deprecated 使用 createScopedThread；保留给尚未迁移的嵌入调用方。 */
  onThreadCreated?: (id: string) => void
  newLabel?: string
  emptyLabel?: string
  defaultAgentMode?: boolean
  contextCandidates?: readonly AgentContextSource[]
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
    createScopedThread,
    deleteScopedThread,
    onThreadCreated,
    newLabel = "新对话",
    emptyLabel = "还没有对话",
    defaultAgentMode,
    contextCandidates = [],
  }: AgentPanelProps = {},
  ref,
) {
  const settings = React.useSyncExternalStore(
    subscribeAgentSettings,
    getAgentSettings,
    getAgentSettings,
  )
  const acpSettings = React.useSyncExternalStore(
    subscribeAcpSettings,
    getAcpSettings,
    getAcpSettings,
  )
  const externalAcpSelected = acpSettings.executionBackend === "external-acp"
  const externalAcpRuntimeAvailable = isTauri()
  const configured = externalAcpSelected
    ? externalAcpRuntimeAvailable && isExternalAcpConfigured(acpSettings)
    : (configuredProp ?? isConfigured(settings))
  const externalAcpConfigurationError = externalAcpRuntimeAvailable
    ? "请先配置外部 ACP Agent"
    : "外部 ACP Agent 仅桌面 App 可用"
  const showHeader = !compact && scopeIds === undefined

  const [threads, setThreads] = React.useState<AgentThread[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<AgentMessage[]>([])
  const [input, setInput] = React.useState("")
  const [preparing, setPreparing] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [streamingId, setStreamingId] = React.useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [agentMode, setAgentMode] = React.useState(
    () => defaultAgentMode ?? settings.defaultAgentMode,
  )
  const [pendingApproval, setPendingApproval] = React.useState<{
    preview: AgentToolPreview
    resolve: (v: boolean) => void
  } | null>(null)

  const approveTool = React.useCallback(
    (preview: AgentToolPreview) =>
      new Promise<boolean>((resolve) => setPendingApproval({ preview, resolve })),
    [],
  )

  const abortRef = React.useRef<AbortController | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const sendingRef = React.useRef(false)
  const messagesRef = React.useRef(messages)
  messagesRef.current = messages

  React.useEffect(() => {
    void hydrateAgentSettingsSecure()
  }, [])

  React.useEffect(() => {
    if (!sendingRef.current) setAgentMode(defaultAgentMode ?? settings.defaultAgentMode)
  }, [defaultAgentMode, settings.defaultAgentMode])

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
        // compact 右栏: 挂载前经 bus 请求的线程优先于 list[0], 避免与 pending 消费竞态。
        const pending = compact ? consumePendingOpenThread() : null
        if (pending) {
          const hit = list.find((t) => t.id === pending)
          const t = hit ?? (await getThread(pending))
          if (t && alive) {
            setActiveId(pending)
            setMessages(t.messages)
            return
          }
        }
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
  }, [compact])

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

  async function selectThread(id: string, opts?: { force?: boolean }) {
    if ((!opts?.force && sendingRef.current) || id === activeId) return
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
  const selectThreadRef = React.useRef(selectThread)
  selectThreadRef.current = selectThread

  // 外部「继续此对话」请求 (thread-viewer 等经 agent-panel-bus): 仅右栏 compact 实例响应,
  // 避免 ai-tasks 等其他实例同时抢切。pending 在上方 listThreads 挂载 effect 中消费。
  React.useEffect(() => {
    if (!compact) return
    return onOpenThreadRequest((id) => {
      void selectThreadRef.current(id, { force: true })
      void refreshThreads()
    })
  }, [compact, refreshThreads])

  async function removeThread(id: string) {
    if (sendingRef.current) return
    try {
      await (deleteScopedThread ?? deleteTaskOrThread)(id)
    } catch (error) {
      toast.error("无法删除对话", { description: String(error) })
      return
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

  const persistArtifactReceipt = React.useCallback(
    async (messageId: string, receipt: AgentArtifactReceipt, warning: string): Promise<void> => {
      const nextMessages = upsertArtifactReceipt(messagesRef.current, messageId, receipt)
      messagesRef.current = nextMessages
      setMessages(nextMessages)

      // 产物与当前 thread 是不同节点，无法跨节点原子提交。产物成功即报告成功；
      // 审计回执失败时明确降级，绝不把已提交动作误报为失败或自动重放。
      if (activeId) {
        try {
          const currentThread = await getThread(activeId)
          if (!currentThread) throw new Error("对话已不存在")
          await invokeFileAction(
            resourceFileRef({ scheme: "node", kind: "thread", id: currentThread.id }),
            "edit",
            {
              content: {
                messages: upsertArtifactReceipt(currentThread.messages, messageId, receipt),
              },
            },
            ARTIFACT_ACTION_CONTEXT,
            { expectedVersion: String(currentThread.updatedAt) },
          )
          void refreshThreads()
        } catch (error) {
          toast.warning(warning, {
            description: error instanceof Error ? error.message : String(error),
          })
        }
      }
    },
    [activeId, refreshThreads],
  )

  const auditArtifactReceipt = React.useCallback(
    async (
      messageId: string,
      receipt: AgentArtifactReceipt,
      status: "committed" | "undone" = "committed",
    ): Promise<void> => {
      const operation =
        status === "undone"
          ? `artifact.${receipt.kind}.undo`
          : receipt.kind === "note"
            ? "artifact.note.create"
            : receipt.kind === "task"
              ? "artifact.task.create"
              : "artifact.bookmark-description.write"
      const title =
        status === "undone"
          ? `撤销${receipt.kind === "task" ? "任务" : "书签描述"}写入`
          : receipt.kind === "note"
            ? "把 AI 回答保存为笔记"
            : receipt.kind === "task"
              ? "把 AI 回答保存为任务"
              : "用 AI 回答更新书签描述"
      try {
        await appendAgentWriteAuditViaFileSystem({
          source: "artifact",
          operation,
          title,
          summary:
            status === "undone" ? "已按原写入版本完成安全撤销" : "已由用户确认并提交本地产物",
          status,
          effect: status === "undone" ? "delete" : "write",
          risk: "medium",
          target: {
            kind: receipt.kind === "bookmark-description" ? "bookmark" : receipt.kind,
            id: receipt.nodeId,
            label: receipt.title,
          },
          ...(activeId ? { threadId: activeId } : {}),
          messageId,
        })
      } catch (error) {
        toast.warning("写操作已完成，但本地审计暂未保存", {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [activeId],
  )

  const saveMessageAsNote = React.useCallback(
    async (messageId: string, draft: AgentNoteDraft): Promise<AgentArtifactReceipt> => {
      const message = messagesRef.current.find((candidate) => candidate.id === messageId)
      if (!message || message.role !== "assistant") throw new Error("这条 AI 回答已不可用")
      const sources = Array.isArray(message.sources) ? message.sources : []
      const receipt = await saveAgentResponseAsNote(draft, sources)
      await persistArtifactReceipt(messageId, receipt, "笔记已创建，但对话回执暂未保存")
      await auditArtifactReceipt(messageId, receipt)
      return receipt
    },
    [auditArtifactReceipt, persistArtifactReceipt],
  )

  const saveMessageAsTask = React.useCallback(
    async (messageId: string, draft: AgentTaskArtifactDraft): Promise<AgentArtifactReceipt> => {
      const message = messagesRef.current.find((candidate) => candidate.id === messageId)
      if (!message || message.role !== "assistant") throw new Error("这条 AI 回答已不可用")
      const sources = Array.isArray(message.sources) ? message.sources : []
      const receipt = await saveAgentResponseAsTask(draft, sources)
      await persistArtifactReceipt(messageId, receipt, "任务已创建，但对话回执暂未保存")
      await auditArtifactReceipt(messageId, receipt)
      return receipt
    },
    [auditArtifactReceipt, persistArtifactReceipt],
  )

  const saveMessageToBookmark = React.useCallback(
    async (
      messageId: string,
      draft: AgentBookmarkDescriptionDraft,
    ): Promise<AgentArtifactReceipt> => {
      const message = messagesRef.current.find((candidate) => candidate.id === messageId)
      if (!message || message.role !== "assistant") throw new Error("这条 AI 回答已不可用")
      const sources = Array.isArray(message.sources) ? message.sources : []
      const receipt = await saveAgentResponseToBookmarkDescription(draft, sources)
      await persistArtifactReceipt(messageId, receipt, "书签已更新，但对话回执暂未保存")
      await auditArtifactReceipt(messageId, receipt)
      return receipt
    },
    [auditArtifactReceipt, persistArtifactReceipt],
  )

  const undoMessageArtifact = React.useCallback(
    async (messageId: string, requested: AgentArtifactReceipt): Promise<void> => {
      if (!isUndoableAgentArtifact(requested)) throw new Error("该产物不支持安全撤销")
      const message = messagesRef.current.find((candidate) => candidate.id === messageId)
      const stored = (Array.isArray(message?.artifacts) ? message.artifacts : [])
        .filter(isAgentArtifactReceipt)
        .find(
          (artifact) =>
            artifact.kind === requested.kind &&
            artifact.nodeId === requested.nodeId &&
            isUndoableAgentArtifact(artifact) &&
            artifact.committedVersion === requested.committedVersion,
        )
      if (!stored || !isUndoableAgentArtifact(stored)) throw new Error("写入回执已变化")
      const undone = await undoAgentArtifact(stored)
      await persistArtifactReceipt(messageId, undone, "写操作已撤销，但审计回执暂未保存")
      await auditArtifactReceipt(messageId, undone, "undone")
    },
    [auditArtifactReceipt, persistArtifactReceipt],
  )

  async function send(override?: string, opts?: { agentMode?: boolean; minContextItems?: number }) {
    const text = (override ?? input).trim()
    if (!text || sendingRef.current) return
    const useAgent = opts?.agentMode ?? agentMode
    const requestedContext = getAgentContextSources()
    if (!configured) {
      toast.error(externalAcpSelected ? externalAcpConfigurationError : "请先配置模型（API Key）")
      openSettings()
      return
    }
    sendingRef.current = true
    setPreparing(true)
    if (override === undefined) setInput("")

    let selectedContext: Awaited<ReturnType<typeof gatherSelectedContext>>
    try {
      selectedContext = await gatherSelectedContext(requestedContext)
      if (opts?.minContextItems && selectedContext.sources.length < opts.minContextItems) {
        toast.error(`至少需要 ${opts.minContextItems} 项仍可读取的上下文资料`)
        if (override === undefined) setInput((current) => current || text)
        setPreparing(false)
        sendingRef.current = false
        return
      }
    } catch (error) {
      toast.error("无法读取所选上下文", { description: String(error) })
      if (override === undefined) setInput((current) => current || text)
      setPreparing(false)
      sendingRef.current = false
      return
    }
    const userMsg = makeMessage("user", text)
    const convo = [...messages, userMsg]
    setMessages(convo)

    let thread: AgentThread
    let createdNew = false
    let createdThreadId: string | null = null
    try {
      if (!activeId) {
        const created = await (createScopedThread ?? createThread)()
        createdNew = true
        createdThreadId = created.id
        thread = { ...created, title: titleFromMessage(text), messages: convo }
      } else {
        const existing = await getThread(activeId)
        if (existing) {
          thread = { ...existing, messages: convo }
        } else {
          createdNew = true
          const created = await (createScopedThread ?? createThread)()
          createdThreadId = created.id
          thread = { ...created, title: titleFromMessage(text), messages: convo }
        }
      }
      await saveThread(thread)
      setActiveId(thread.id)
      if (createdNew) onThreadCreated?.(thread.id)
      refreshThreads()
    } catch (e) {
      if (createdThreadId) {
        try {
          await (deleteScopedThread ?? deleteTaskOrThread)(createdThreadId)
        } catch {
          // 保留原始保存错误；残留项仍在列表中可见并可重试删除。
        }
      }
      toast.error("无法保存对话", { description: String(e) })
      setPreparing(false)
      sendingRef.current = false
      return
    }

    let runCfg: ResolvedRun
    try {
      if (resolveRun) {
        const r = await resolveRun(useAgent, selectedContext.text)
        if (!r) {
          toast.error(
            externalAcpSelected ? externalAcpConfigurationError : "请先配置模型（API Key）",
          )
          openSettings()
          setPreparing(false)
          sendingRef.current = false
          return
        }
        runCfg = r
      } else {
        const cfg = await hydrateAgentSettingsSecure()
        let system = ""
        try {
          const ctx = cfg.includeHomeContext ? await gatherHomeContext() : ""
          system = buildSystemPrompt(ctx, {
            tools: useAgent,
            selected: selectedContext.text,
          })
        } catch {
          system = buildSystemPrompt("", { tools: useAgent, selected: selectedContext.text })
        }
        runCfg = externalAcpSelected
          ? {
              backend: "external-acp",
              externalAgent: acpSettings.externalAgent,
              system,
            }
          : {
              backend: "model",
              baseURL: cfg.baseURL,
              model: cfg.model,
              apiKey: cfg.apiKey,
              system,
            }
      }
    } catch (e) {
      toast.error("无法准备发送", { description: String(e) })
      setPreparing(false)
      sendingRef.current = false
      return
    }

    const apiMessages: ExternalAcpMessage[] = [
      { role: "system", content: runCfg.system },
      ...convo.slice(-HISTORY_LIMIT).map((m) => ({ role: m.role, content: m.content })),
    ]

    const asst: AgentMessage = {
      ...makeMessage("assistant", ""),
      ...(selectedContext.sources.length ? { sources: selectedContext.sources } : {}),
    }
    setMessages((prev) => [...prev, asst])
    setStreamingId(asst.id)
    setPreparing(false)
    setSending(true)
    const controller = new AbortController()
    abortRef.current = controller

    let acc = ""
    let toolEvents: AgentToolEvent[] = []
    let canceled = false
    let auditWarningShown = false
    try {
      if (runCfg.backend === "external-acp") {
        const res = await runExternalAcpAgent({
          config: runCfg.externalAgent,
          messages: apiMessages,
          signal: controller.signal,
          allowPermissions: useAgent,
          onApprove: approveTool,
          onPermissionIntent: async (preview) => {
            try {
              return await appendAgentWriteAuditViaFileSystem({
                source: "tool",
                operation: preview.toolName,
                title: preview.title,
                summary: "已批准外部 Agent 权限，等待可验证结果",
                status: "pending",
                effect: preview.effect,
                risk: preview.risk,
                ...(preview.target ? { target: preview.target } : {}),
                threadId: thread.id,
                messageId: asst.id,
              })
            } catch (error) {
              toast.error("无法建立耐久审计，外部 Agent 权限未授予", {
                description: error instanceof Error ? error.message : String(error),
              })
              throw error
            }
          },
          onPermissionAudit: async (event) => {
            try {
              const { preview, status, summary, auditId } = event
              if (auditId && status !== "rejected") {
                await completeAgentWriteAuditViaFileSystem({ id: auditId, status, summary })
              } else {
                await appendAgentWriteAuditViaFileSystem({
                  source: "tool",
                  operation: preview.toolName,
                  title: preview.title,
                  summary,
                  status,
                  effect: preview.effect,
                  risk: preview.risk,
                  ...(preview.target ? { target: preview.target } : {}),
                  threadId: thread.id,
                  messageId: asst.id,
                })
              }
            } catch (error) {
              if (auditWarningShown) return
              auditWarningShown = true
              toast.warning(
                event.auditId ? "外部工具已返回，审计结果仍待确认" : "本地审计暂未保存",
                {
                  description: error instanceof Error ? error.message : String(error),
                },
              )
            }
          },
          onUpdate: (content, events) => {
            acc = content
            toolEvents = events
            setMessages((prev) =>
              prev.map((m) => (m.id === asst.id ? { ...m, content: acc, toolEvents: events } : m)),
            )
          },
        })
        canceled = res.canceled
        acc = res.content
        toolEvents = res.toolEvents
      } else if (useAgent) {
        const res = await runAgent({
          baseURL: runCfg.baseURL,
          model: runCfg.model,
          apiKey: runCfg.apiKey,
          messages: apiMessages,
          signal: controller.signal,
          mcp: runCfg.mcp,
          approvalPolicy: settings.approvalPolicy,
          onApprove: approveTool,
          onToolIntent: async (preview) => {
            try {
              return await appendAgentWriteAuditViaFileSystem({
                source: "tool",
                operation: preview.toolName,
                title: preview.title,
                summary: "已批准，等待执行",
                status: "pending",
                effect: preview.effect,
                risk: preview.risk,
                ...(preview.target ? { target: preview.target } : {}),
                threadId: thread.id,
                messageId: asst.id,
              })
            } catch (error) {
              toast.error("无法建立耐久审计，工具未执行", {
                description: error instanceof Error ? error.message : String(error),
              })
              throw error
            }
          },
          onToolAudit: async (event) => {
            try {
              const { preview, status, summary, auditId } = event
              if (auditId && status !== "rejected") {
                await completeAgentWriteAuditViaFileSystem({ id: auditId, status, summary })
              } else {
                await appendAgentWriteAuditViaFileSystem({
                  source: "tool",
                  operation: preview.toolName,
                  title: preview.title,
                  summary,
                  status,
                  effect: preview.effect,
                  risk: preview.risk,
                  ...(preview.target ? { target: preview.target } : {}),
                  threadId: thread.id,
                  messageId: asst.id,
                })
              }
            } catch (error) {
              if (auditWarningShown) return
              auditWarningShown = true
              toast.warning(event.auditId ? "工具已返回，审计结果仍待确认" : "本地审计暂未保存", {
                description: error instanceof Error ? error.message : String(error),
              })
            }
          },
          onToolEvent: (ev) => {
            toolEvents = [...toolEvents, ev]
            setMessages((prev) => prev.map((m) => (m.id === asst.id ? { ...m, toolEvents } : m)))
          },
        })
        canceled = res.canceled === true
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
        canceled = controller.signal.aborted
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        canceled = true
      } else if (controller.signal.aborted) {
        canceled = true
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        toast.error(
          runCfg.backend === "external-acp"
            ? "外部 Agent 出错"
            : useAgent
              ? "智能体出错"
              : "对话出错",
          { description: msg },
        )
        if (!acc) acc = `（请求出错：${msg}）`
      }
    } finally {
      if (canceled) {
        setMessages((prev) => prev.filter((m) => m.id !== asst.id))
      } else if ((runCfg.backend === "external-acp" || useAgent) && !acc.trim()) {
        const operationEvents = toolEvents.filter((t) => !t.name.startsWith("mcp:"))
        acc = operationEvents.length
          ? `已执行 ${operationEvents.length} 个操作：${operationEvents.map((t) => t.summary).join("；")}`
          : toolEvents.length
            ? toolEvents.map((t) => t.summary).join("；")
            : "（智能体没有返回内容）"
      }
      if (!canceled) {
        setMessages((prev) =>
          prev.map((m) => (m.id === asst.id ? { ...m, content: acc, toolEvents } : m)),
        )
      }
      setSending(false)
      setStreamingId(null)
      abortRef.current = null
    }

    if (canceled) {
      sendingRef.current = false
      return
    }

    try {
      const finalAsst: AgentMessage = {
        ...asst,
        content: acc,
        ...(toolEvents.length ? { toolEvents } : {}),
        ...(selectedContext.sources.length ? { sources: selectedContext.sources } : {}),
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
      toast.error(externalAcpSelected ? externalAcpConfigurationError : "请先配置模型（API Key）")
      openSettings()
      return
    }
    const selectedCount = getAgentContextSources().length
    if (skill.minContextItems && selectedCount < skill.minContextItems) {
      toast.error(`请先在上下文托盘加入至少 ${skill.minContextItems} 项资料`)
      return
    }
    if (skill.needsActiveNode) {
      const active = getActiveNodeRef()
      if (!active) {
        toast.error("请先打开一篇笔记或一段对话，技能才能读到当前内容")
        return
      }
      void (async () => {
        const node = await getFilesPort()
          .fsGetNode(active.id)
          .catch(() => undefined)
        if (!node || node.kind !== active.kind || node.deletedAt != null) {
          toast.error("当前资料已不可用")
          return
        }
        const result = addAgentContextSource(
          nodeAgentContextSource(node.kind, node.id, node.title || "当前资料"),
        )
        if (result === "full") {
          toast.error("上下文托盘已满，请先移除一项资料")
          return
        }
        if (!sendingRef.current) {
          void send(skill.prompt, {
            agentMode: skill.agentMode,
            minContextItems: skill.minContextItems,
          })
        }
      })()
      return
    }
    void send(skill.prompt, {
      agentMode: skill.agentMode,
      minContextItems: skill.minContextItems,
    })
  }

  const shownThreads = scopeIds
    ? threads.filter((t) => scopeIds.includes(t.id) || t.id === activeId)
    : threads

  const statusLabel = externalAcpSelected
    ? configured
      ? `外部 · ${acpSettings.externalAgent.program.trim()}`
      : externalAcpRuntimeAvailable
        ? "未配置外部 Agent"
        : "外部 Agent 仅桌面可用"
    : configured
      ? (modelLabel ?? settings.model)
      : "未配置模型"

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
              <h1 className="text-[15px] font-semibold leading-tight">AI 智能体</h1>
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
                    onSaveNote={saveMessageAsNote}
                    onSaveTask={saveMessageAsTask}
                    onSaveBookmark={saveMessageToBookmark}
                    onUndoArtifact={undoMessageArtifact}
                    actionsDisabled={preparing || sending}
                  />
                ))}
          </div>
        </div>

        {pendingApproval && (
          <ToolApprovalBar
            compact={compact}
            pending={pendingApproval.preview}
            onDecide={(allow) =>
              setPendingApproval((p) => {
                p?.resolve(allow)
                return null
              })
            }
          />
        )}

        <AgentContextTray candidates={contextCandidates} disabled={preparing || sending} />

        <AgentComposer
          compact={compact}
          configured={configured}
          preparing={preparing}
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
