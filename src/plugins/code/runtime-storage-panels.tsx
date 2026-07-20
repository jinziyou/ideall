"use client"

import { Bug, HardDrive, Info } from "lucide-react"
import { formatBytes } from "@/lib/format"
import type { CodeSnapshot, StorageBucket } from "./code-snapshot"
import { SectionTitle } from "./code-page-chrome"

export function RuntimeOverview({ snapshot }: { snapshot: CodeSnapshot }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="rounded-lg border border-border/60 bg-card">
        <SectionTitle icon={Info} title="运行环境" />
        <dl className="grid gap-2 p-4 text-sm">
          {Object.entries(snapshot.runtime).map(([key, value]) => (
            <div key={key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="min-w-0 break-words font-mono text-xs">{String(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-lg border border-border/60 bg-card">
        <SectionTitle icon={Bug} title="工作区快照" />
        {snapshot.workspace ? (
          <dl className="grid gap-2 p-4 text-sm">
            {Object.entries(snapshot.workspace).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="min-w-0 break-words font-mono text-xs">{String(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">没有工作区持久化快照</div>
        )}
      </section>
    </div>
  )
}

export function StorageOverview({ snapshot }: { snapshot: CodeSnapshot }) {
  return (
    <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
      <StoragePanel title="localStorage" bucket={snapshot.storage.localStorage} />
      <StoragePanel title="sessionStorage" bucket={snapshot.storage.sessionStorage} />
    </section>
  )
}

function StoragePanel({ title, bucket }: { title: string; bucket: StorageBucket }) {
  const entries = bucket.entries
  return (
    <section className="min-h-0 rounded-lg border border-border/60 bg-card">
      <SectionTitle icon={HardDrive} title={`${title} · ${entries.length}`} />
      <div className="max-h-[420px] overflow-auto p-2">
        {bucket.error ? (
          <div className="px-2 py-8 text-center text-sm text-destructive">{bucket.error}</div>
        ) : entries.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">无数据</div>
        ) : (
          <div className="flex flex-col gap-1">
            {entries.map((entry) => (
              <div key={entry.key} className="rounded-md px-2 py-2 hover:bg-muted/60">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-mono text-xs">{entry.key}</p>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatBytes(entry.bytes)}
                  </span>
                </div>
                {entry.redacted && (
                  <div className="mt-1 text-[10px] font-medium text-amber-600">已脱敏</div>
                )}
                {entry.error && (
                  <div className="mt-1 text-[10px] font-medium text-destructive">读取失败</div>
                )}
                {entry.preview && (
                  <pre className="mt-1 overflow-hidden text-ellipsis whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground">
                    {entry.preview}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
