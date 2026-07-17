"use client"

import * as React from "react"
import { FileText, Link as LinkIcon, Plus, X } from "lucide-react"
import { toast } from "sonner"
import {
  AGENT_CONTEXT_TRAY_LIMIT,
  addAgentContextSource,
  clearAgentContextSources,
  getAgentContextSources,
  getServerAgentContextSources,
  removeAgentContextSource,
  subscribeAgentContextSources,
  type AgentContextSource,
} from "@/lib/agent-context-tray"
import { Button } from "@/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"

function addSource(source: AgentContextSource): void {
  const result = addAgentContextSource(source)
  if (result === "exists") toast.info("该资料已在上下文托盘中")
  if (result === "full") toast.error(`上下文托盘最多放入 ${AGENT_CONTEXT_TRAY_LIMIT} 项资料`)
}

export default function AgentContextTray({
  candidates,
  disabled,
}: {
  candidates: readonly AgentContextSource[]
  disabled?: boolean
}) {
  const selected = React.useSyncExternalStore(
    subscribeAgentContextSources,
    getAgentContextSources,
    getServerAgentContextSources,
  )
  const selectedKeys = React.useMemo(
    () => new Set(selected.map((source) => source.key)),
    [selected],
  )
  const available = React.useMemo(() => {
    const unique = new Map<string, AgentContextSource>()
    for (const candidate of candidates) {
      if (!selectedKeys.has(candidate.key)) unique.set(candidate.key, candidate)
    }
    return [...unique.values()]
  }, [candidates, selectedKeys])

  return (
    <div className="shrink-0 border-t bg-muted/20 px-4 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          上下文 {selected.length}/{AGENT_CONTEXT_TRAY_LIMIT}
        </span>
        <span className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={disabled}>
                <Plus className="h-3.5 w-3.5" />
                从打开标签添加
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {available.length === 0 ? (
                <DropdownMenuItem disabled>没有可添加的本地资料标签</DropdownMenuItem>
              ) : (
                available.map((source) => (
                  <DropdownMenuItem key={source.key} onSelect={() => addSource(source)}>
                    {source.type === "url" ? (
                      <LinkIcon className="h-4 w-4" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                    <span className="truncate">{source.title}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {selected.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={disabled}
              onClick={clearAgentContextSources}
            >
              清空
            </Button>
          ) : null}
        </span>
      </div>
      {selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((source) => (
            <span
              key={source.key}
              className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
              title={source.type === "node" ? "发送所选对象的受控内容" : "仅发送链接"}
            >
              {source.type === "url" ? (
                <LinkIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="max-w-48 truncate">{source.title}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeAgentContextSource(source.key)}
                className="rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label={`移除 ${source.title}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          只有明确放入这里的私密正文才会随下一次提问发送。
        </p>
      )}
    </div>
  )
}
