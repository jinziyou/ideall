"use client"

import * as React from "react"
import { Bug, ClipboardCopy, HardDrive, Info, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { isTauri } from "@/lib/tauri"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/empty-state"
import { safeStoragePreview } from "./debug-redact"

type StorageEntry = {
  key: string
  bytes: number
  preview: string
  redacted: boolean
}

type DebugSnapshot = {
  generatedAt: string
  runtime: {
    href: string
    userAgent: string
    language: string
    online: boolean
    timezone: string
    viewport: string
    tauri: boolean
  }
  storage: {
    localStorage: StorageEntry[]
    sessionStorage: StorageEntry[]
  }
  workspace?: {
    source: "localStorage" | "sessionStorage"
    tabs: number
    activeId: string | null
    activeModule: string | null
    mode: string | null
  }
}

const WORKSPACE_KEY = "ideall:workspace:v1"

export default function DebugPage() {
  const [snapshot, setSnapshot] = React.useState<DebugSnapshot | null>(null)

  const refresh = React.useCallback(() => {
    setSnapshot(readSnapshot())
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const copySnapshot = async () => {
    if (!snapshot) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))
      toast("已复制诊断信息")
    } catch {
      toast.error("复制失败")
    }
  }

  if (!snapshot) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader />
        <EmptyState icon={Bug} title="正在读取调试信息" bordered />
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4">
      <PageHeader onRefresh={refresh} onCopy={() => void copySnapshot()} />

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

      <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <StoragePanel title="localStorage" entries={snapshot.storage.localStorage} />
        <StoragePanel title="sessionStorage" entries={snapshot.storage.sessionStorage} />
      </section>
    </div>
  )
}

function readSnapshot(): DebugSnapshot {
  const local = readStorage(localStorage)
  const session = readStorage(sessionStorage)
  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      href: window.location.href,
      userAgent: navigator.userAgent,
      language: navigator.language,
      online: navigator.onLine,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      tauri: isTauri(),
    },
    storage: {
      localStorage: local,
      sessionStorage: session,
    },
    workspace:
      readWorkspace(sessionStorage.getItem(WORKSPACE_KEY), "sessionStorage") ??
      readWorkspace(localStorage.getItem(WORKSPACE_KEY), "localStorage"),
  }
}

function readStorage(storage: Storage): StorageEntry[] {
  const entries: StorageEntry[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (!key) continue
    const value = storage.getItem(key) ?? ""
    const preview = safeStoragePreview(key, value)
    entries.push({
      key,
      bytes: new Blob([value]).size,
      preview: preview.value,
      redacted: preview.redacted,
    })
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key))
}

function readWorkspace(
  raw: string | null,
  source: "localStorage" | "sessionStorage",
): DebugSnapshot["workspace"] | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as {
      tabs?: unknown[]
      activeId?: unknown
      activeModule?: unknown
      mode?: unknown
    }
    return {
      source,
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs.length : 0,
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
      activeModule: typeof parsed.activeModule === "string" ? parsed.activeModule : null,
      mode: typeof parsed.mode === "string" ? parsed.mode : null,
    }
  } catch {
    return {
      source,
      tabs: 0,
      activeId: null,
      activeModule: "parse-error",
      mode: null,
    }
  }
}

function StoragePanel({ title, entries }: { title: string; entries: StorageEntry[] }) {
  return (
    <section className="min-h-0 rounded-lg border border-border/60 bg-card">
      <SectionTitle icon={HardDrive} title={`${title} · ${entries.length}`} />
      <div className="max-h-[420px] overflow-auto p-2">
        {entries.length === 0 ? (
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

function SectionTitle({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
      <Icon className="h-4 w-4 text-primary" />
      <h2 className="text-sm font-medium">{title}</h2>
    </div>
  )
}

function PageHeader({ onRefresh, onCopy }: { onRefresh?: () => void; onCopy?: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Debug</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            本地运行态、工作区快照与浏览器存储诊断
          </p>
        </div>
        {onRefresh && onCopy && (
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onCopy}>
              <ClipboardCopy className="h-4 w-4" />
              复制
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onRefresh}
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}
