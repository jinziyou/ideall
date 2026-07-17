"use client"

// AI 输入区 (AgentPanel 底部): 智能体开关 + 技能菜单 + 输入框 + 发送/停止, 以及工具执行确认条。
// 纯展示组件 —— 发送编排与全部状态归 AgentPanel; 仅中文输入法组合态 (composingRef) 归本组件
// (composition 事件就发生在这里的输入框上)。
import * as React from "react"
import { Loader2, Send, Sparkles, Wrench, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { Chip } from "@/ui/chip"
import { Textarea } from "@/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import type { AgentSkill } from "../lib/agent-skills"
import type { AgentToolPreview } from "../lib/agent-tool-preview"
import { ComposerShell } from "./ui-kit"

/** 工具执行确认条 (approvalPolicy=confirm 时智能体调工具前弹出): 允许 / 拒绝。 */
export function ToolApprovalBar({
  compact,
  pending,
  onDecide,
}: {
  compact: boolean
  pending: AgentToolPreview
  onDecide: (allow: boolean) => void
}) {
  return (
    <div className={cn("shrink-0", compact ? "px-4 pb-3" : "mt-4")}>
      <ComposerShell className="flex items-start justify-between gap-4 text-sm">
        <span className="min-w-0 space-y-2 text-[13px]">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{pending.title}</span>
            <Chip
              tone={
                pending.risk === "high" ? "error" : pending.risk === "medium" ? "warn" : "neutral"
              }
            >
              {pending.risk === "high" ? "高风险" : pending.risk === "medium" ? "中风险" : "低风险"}
            </Chip>
          </span>
          <span className="block leading-5 text-muted-foreground">{pending.summary}</span>
          {pending.target && (
            <span className="block break-all">
              <span className="text-muted-foreground">目标：</span>
              {pending.target.label}
              {pending.target.kind ? ` · ${pending.target.kind}` : ""}
              {pending.target.id ? ` · ${pending.target.id}` : ""}
            </span>
          )}
          {pending.fields.map((field) => (
            <span key={field.label} className="block break-all">
              <span className="text-muted-foreground">{field.label}：</span>
              {field.value}
            </span>
          ))}
          <span className="block font-mono text-[11px] text-muted-foreground">
            {pending.toolName}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => onDecide(false)}>
            拒绝
          </Button>
          <Button size="sm" onClick={() => onDecide(true)}>
            允许
          </Button>
        </span>
      </ComposerShell>
    </div>
  )
}

export default function AgentComposer({
  compact,
  configured,
  preparing,
  sending,
  streaming,
  agentMode,
  onToggleAgentMode,
  skills,
  onRunSkill,
  input,
  onInputChange,
  onSend,
  onStop,
  onOpenSettings,
  inputRef,
}: {
  compact: boolean
  configured: boolean
  /** 正在读取上下文、创建线程或解析运行配置；尚无可中止的网络请求。 */
  preparing: boolean
  sending: boolean
  /** 是否正在流式输出 (发送钮的 spinner 态)。 */
  streaming: boolean
  agentMode: boolean
  onToggleAgentMode: () => void
  skills: AgentSkill[]
  onRunSkill: (skill: AgentSkill) => void
  input: string
  onInputChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  onOpenSettings: () => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  // WebKitGTK 下 keydown.isComposing 不可靠, 以 composition 事件自记组合态兜底 (防 IME 上屏误发送)。
  const composingRef = React.useRef(false)
  const busy = preparing || sending

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !composingRef.current) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <div
      className={cn(
        "shrink-0 space-y-3",
        compact ? "border-t bg-card px-4 py-4" : "mx-auto mt-6 w-full max-w-2xl",
      )}
    >
      {compact && !configured && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={onOpenSettings}>
            去配置
          </Button>
        </div>
      )}
      <ComposerShell className={cn("space-y-3", compact && "border-0 bg-transparent p-0")}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleAgentMode}
            disabled={busy}
            title="开启后智能体可读写「我的」的数据"
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
                disabled={busy}
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
                  onSelect={() => onRunSkill(s)}
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
                ? "配置执行后端后即可对话…"
                : agentMode
                  ? "让智能体整理本机的关注、书签、资源…"
                  : "输入消息，Enter 发送，Shift+Enter 换行"
            }
            className="min-h-[2.75rem] max-h-40 flex-1 resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            onChange={(e) => onInputChange(e.target.value)}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={() => {
              composingRef.current = false
            }}
            onKeyDown={onKeyDown}
          />
          {sending ? (
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={onStop}
              title="停止"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">停止</span>
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={onSend}
              disabled={preparing || !input.trim()}
              title="发送"
            >
              {preparing || streaming ? (
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
  )
}
