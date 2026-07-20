"use client"

import { Database, RefreshCw } from "lucide-react"
import { formatBytes } from "@/lib/format"
import type { LocalDataSchemaInspection } from "@/plugins/shared/local-data-schema"
import { Button } from "@/ui/button"
import { SectionTitle } from "./code-page-chrome"

export function SchemaPanel({
  entries,
  repairing,
  onRepair,
  onRepairAll,
}: {
  entries: LocalDataSchemaInspection[]
  repairing: string | null
  onRepair: (id: string) => void
  onRepairAll: () => void
}) {
  const issueCount = entries.filter((entry) =>
    ["warning", "error", "unknown"].includes(entry.status),
  ).length
  const repairableCount = entries.filter(
    (entry) => entry.repairable && ["warning", "error"].includes(entry.status),
  ).length
  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <SectionTitle
        icon={Database}
        title={`数据 Schema · ${entries.length}`}
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2"
            disabled={!repairableCount || repairing !== null}
            onClick={onRepairAll}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${repairing === "*" ? "animate-spin" : ""}`} />
            修复全部
          </Button>
        }
      />
      <div className="overflow-auto p-2">
        {entries.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            正在读取 schema 状态
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 px-2 text-xs text-muted-foreground">
              <span>
                {issueCount ? `${issueCount} 项需要关注` : "全部已知 schema 正常或未创建"}
              </span>
              <span>·</span>
              <span>{entries.filter((entry) => entry.portable).length} 项支持插件数据迁移</span>
              <span>·</span>
              <span>{repairableCount} 项可自动修复</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {entries.map((entry) => (
                <div
                  key={`${entry.id}:${entry.key}`}
                  className="rounded-md border border-border/60 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{entry.label}</p>
                        <SchemaStatusBadge status={entry.status} />
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                        {entry.key} · v{entry.currentVersion}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {entry.bytes === null ? "未知" : formatBytes(entry.bytes)}
                      </span>
                      {entry.repairable && ["warning", "error"].includes(entry.status) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={repairing !== null}
                          onClick={() => onRepair(entry.id)}
                        >
                          {repairing === entry.id ? "修复中" : "修复"}
                        </Button>
                      )}
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">位置</dt>
                    <dd>{entry.storage}</dd>
                    <dt className="text-muted-foreground">归属</dt>
                    <dd>{entry.owner}</dd>
                    <dt className="text-muted-foreground">状态</dt>
                    <dd className="min-w-0 break-words">{entry.detail}</dd>
                    {(entry.sensitive || entry.portable) && (
                      <>
                        <dt className="text-muted-foreground">标记</dt>
                        <dd className="flex flex-wrap gap-1">
                          {entry.sensitive && (
                            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-700">
                              敏感
                            </span>
                          )}
                          {entry.portable && (
                            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700">
                              可迁移
                            </span>
                          )}
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function SchemaStatusBadge({ status }: { status: LocalDataSchemaInspection["status"] }) {
  const label =
    status === "ok"
      ? "正常"
      : status === "missing"
        ? "未创建"
        : status === "warning"
          ? "关注"
          : status === "error"
            ? "异常"
            : "未知"
  const className =
    status === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
      : status === "missing"
        ? "border-border bg-muted text-muted-foreground"
        : status === "warning"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
          : status === "error"
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "border-border bg-muted text-muted-foreground"
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
      {label}
    </span>
  )
}
