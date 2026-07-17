"use client"

import * as React from "react"
import { RefreshCw, ShieldCheck } from "lucide-react"
import type { FileRef } from "@protocol/file-system"
import { readFile, watchFile } from "@/filesystem/registry"
import { Button } from "@/ui/button"
import { Chip } from "@/ui/chip"
import { cn } from "@/lib/utils"
import {
  isAgentWriteAuditRecord,
  type AgentWriteAuditRecord,
  type AgentWriteAuditStatus,
} from "../lib/agent-write-audit"
import type { AgentToolRisk } from "../lib/agent-tool-preview"
import { AiPage } from "./ui-kit"

const STATUS_LABEL: Readonly<Record<AgentWriteAuditStatus, string>> = {
  pending: "结果待确认",
  committed: "已提交",
  failed: "失败",
  rejected: "已拒绝",
  undone: "已撤销",
}

const RISK_LABEL: Readonly<Record<AgentToolRisk, string>> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
}

function statusTone(status: AgentWriteAuditStatus): "ok" | "warn" | "error" | "neutral" {
  if (status === "committed") return "ok"
  if (status === "failed") return "error"
  if (status === "pending" || status === "rejected") return "warn"
  return "neutral"
}

function riskTone(risk: AgentToolRisk): "neutral" | "warn" | "error" {
  if (risk === "high") return "error"
  if (risk === "medium") return "warn"
  return "neutral"
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value)
}

const READ_CONTEXT = { actor: "ui", permissions: [], intent: "content" } as const
const WATCH_CONTEXT = { actor: "ui", permissions: [], intent: "watch" } as const

export default function AgentWriteAudit({ fileRef }: { fileRef: FileRef }) {
  const [records, setRecords] = React.useState<AgentWriteAuditRecord[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    setError(null)
    try {
      const result = await readFile(fileRef, READ_CONTEXT, { encoding: "json" })
      const document =
        result.data && typeof result.data === "object" && !Array.isArray(result.data)
          ? (result.data as Record<string, unknown>)
          : null
      if (document?.version !== 1 || !Array.isArray(document.records)) {
        throw new Error("审计文档结构无效")
      }
      const next = document.records.filter(isAgentWriteAuditRecord)
      if (next.length !== document.records.length) throw new Error("审计记录结构无效")
      setRecords(next.slice(0, 200))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [fileRef])

  React.useEffect(() => {
    void refresh()
    const watch = watchFile(fileRef, WATCH_CONTEXT, () => void refresh())
    return () => watch?.dispose()
  }, [fileRef, refresh])

  return (
    <AiPage
      title="AI 写入审计"
      icon={ShieldCheck}
      action={
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          刷新
        </Button>
      }
    >
      <div className="mb-5 rounded-lg border bg-muted/30 px-4 py-3 text-[13px] leading-5 text-muted-foreground">
        仅保存本机脱敏摘要、目标身份与结果；不保存工具原始参数、表单输入、AI 正文或凭据。
        “结果待确认”表示执行前意图已落盘，但应用未取得或未能保存最终回执，需要人工核对目标状态。
        最多保留最近 1,000 条，当前显示最近 200 条。
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          无法读取本地审计：{error}
        </div>
      ) : loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">正在读取本地审计…</div>
      ) : records.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          还没有 Agent 写操作记录。
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((record) => (
            <article key={record.id} className="rounded-lg border bg-card px-4 py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium">{record.title}</h2>
                    <Chip tone={statusTone(record.status)}>{STATUS_LABEL[record.status]}</Chip>
                    <Chip tone={riskTone(record.risk)}>{RISK_LABEL[record.risk]}</Chip>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                    {record.summary}
                  </p>
                </div>
                <time className="shrink-0 text-xs text-muted-foreground">
                  {formatTime(record.updatedAt)}
                </time>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2.5 text-xs text-muted-foreground">
                <span>{record.source === "artifact" ? "AI 产物" : record.operation}</span>
                {record.target && (
                  <span className="max-w-full truncate">
                    目标：{record.target.label}
                    {record.target.kind ? ` · ${record.target.kind}` : ""}
                    {record.target.id ? ` · ${record.target.id}` : ""}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </AiPage>
  )
}
