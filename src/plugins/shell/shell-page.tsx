"use client"

import * as React from "react"
import { ClipboardCopy, Play, RotateCcw, Square, Terminal, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { Button } from "@/ui/button"
import { Chip } from "@/ui/chip"
import { Input } from "@/ui/input"
import { EmptyState } from "@/ui/empty-state"
import { SurfacePanel } from "@/ui/panel"
import { StatusDot, type Tone } from "@/ui/status-dot"
import { executeStreaming, type ShellLine } from "./shell-commands"

type HistoryStatus = "running" | "exited" | "error" | "stopped"

type HistoryItem = {
  id: string
  command: string
  cwd?: string
  lines: ShellLine[]
  startedAt: number
  endedAt?: number
  finished: boolean
  status: HistoryStatus
  exitCode?: number
}

const MAX_COMMAND_HISTORY = 50

export default function ShellPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [history, setHistory] = React.useState<HistoryItem[]>([])
  const [commandHistory, setCommandHistory] = React.useState<string[]>([])
  const [historyCursor, setHistoryCursor] = React.useState<number | null>(null)
  const [input, setInput] = React.useState("")
  const [cwdInput, setCwdInput] = React.useState("")
  const [running, setRunning] = React.useState(false)
  const [stopping, setStopping] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const killRef = React.useRef<(() => void) | null>(null)
  const runningIdRef = React.useRef<string | null>(null)
  const stopRequestedRef = React.useRef(false)
  const historyDraftRef = React.useRef("")

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [history])

  React.useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  React.useEffect(() => {
    return () => {
      if (killRef.current) {
        killRef.current()
        killRef.current = null
      }
    }
  }, [])

  const pushCommandHistory = React.useCallback((command: string) => {
    setCommandHistory((items) => {
      const next = [...items.filter((item) => item !== command), command]
      return next.slice(-MAX_COMMAND_HISTORY)
    })
    setHistoryCursor(null)
    historyDraftRef.current = ""
  }, [])

  const finishRun = React.useCallback((id: string) => {
    if (runningIdRef.current !== id) return
    killRef.current = null
    runningIdRef.current = null
    stopRequestedRef.current = false
    setRunning(false)
    setStopping(false)
  }, [])

  const runCommand = React.useCallback(async () => {
    const command = input.trim()
    if (!command || running) return
    const cwd = cwdInput.trim()
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const item: HistoryItem = {
      id,
      command,
      cwd: cwd || undefined,
      lines: [],
      startedAt: Date.now(),
      finished: false,
      status: "running",
    }
    setHistory((h) => [...h, item])
    setInput("")
    setRunning(true)
    setStopping(false)
    setNow(Date.now())
    runningIdRef.current = id
    stopRequestedRef.current = false
    pushCommandHistory(command)

    try {
      const kill = await executeStreaming(
        command,
        (line) => {
          const terminalLine = line.type === "exit" || line.type === "error"
          setHistory((h) => {
            const target = h.find((x) => x.id === id)
            if (!target || target.finished) return h
            const stopped = terminalLine && stopRequestedRef.current
            const next: HistoryItem = {
              ...target,
              lines: [...target.lines, line],
              finished: terminalLine,
              endedAt: terminalLine ? Date.now() : target.endedAt,
              status: stopped
                ? "stopped"
                : line.type === "error"
                  ? "error"
                  : line.type === "exit"
                    ? "exited"
                    : target.status,
              exitCode: line.type === "exit" ? line.code : target.exitCode,
            }
            return h.map((x) => (x.id === id ? next : x))
          })
          if (terminalLine) finishRun(id)
        },
        { cwd },
      )
      if (runningIdRef.current === id) killRef.current = kill
    } catch (e) {
      setHistory((h) =>
        h.map((x) =>
          x.id === id
            ? {
                ...x,
                lines: [...x.lines, { type: "error", message: String(e) }],
                finished: true,
                endedAt: Date.now(),
                status: "error",
              }
            : x,
        ),
      )
      finishRun(id)
    }
  }, [cwdInput, finishRun, input, pushCommandHistory, running])

  const stopCommand = React.useCallback(() => {
    if (!killRef.current) return
    stopRequestedRef.current = true
    setStopping(true)
    killRef.current()
  }, [])

  const clearHistory = () => {
    if (killRef.current) {
      killRef.current()
      killRef.current = null
    }
    runningIdRef.current = null
    stopRequestedRef.current = false
    setHistory([])
    setRunning(false)
    setStopping(false)
  }

  const recallCommand = (command: string) => {
    setInput(command)
    setHistoryCursor(null)
    historyDraftRef.current = ""
  }

  const copyOutput = async (item: HistoryItem) => {
    const output = item.lines
      .filter(
        (line): line is Extract<ShellLine, { type: "stdout" | "stderr" }> =>
          line.type === "stdout" || line.type === "stderr",
      )
      .map((line) => line.text)
      .join("\n")
    try {
      await navigator.clipboard.writeText(output || "")
      toast(output ? "已复制输出" : "输出为空，已复制空文本")
    } catch {
      toast.error("复制失败")
    }
  }

  const walkCommandHistory = (direction: "prev" | "next") => {
    if (commandHistory.length === 0) return
    if (direction === "prev") {
      const nextCursor =
        historyCursor === null ? commandHistory.length - 1 : Math.max(0, historyCursor - 1)
      if (historyCursor === null) historyDraftRef.current = input
      setHistoryCursor(nextCursor)
      setInput(commandHistory[nextCursor])
      return
    }
    if (historyCursor === null) return
    const nextCursor = historyCursor + 1
    if (nextCursor >= commandHistory.length) {
      setHistoryCursor(null)
      setInput(historyDraftRef.current)
      historyDraftRef.current = ""
      return
    }
    setHistoryCursor(nextCursor)
    setInput(commandHistory[nextCursor])
  }

  if (!isTauri()) {
    return (
      <div className={cn("mx-auto flex h-full w-full max-w-4xl flex-col gap-6", embedded && "p-3")}>
        {!embedded && <PageHeader />}
        <EmptyState icon={Terminal} title="本地终端仅在桌面 App 中可用" bordered />
      </div>
    )
  }

  return (
    <div className={cn("h-full w-full overflow-hidden", embedded ? "p-3" : "p-4 sm:p-6")}>
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-4">
        {!embedded && <PageHeader />}

        {!embedded && (
          <SessionSummary
            commandHistoryCount={commandHistory.length}
            historyCount={history.length}
            running={running}
            stopping={stopping}
          />
        )}

        <SurfacePanel className="min-h-0 flex-1 border-border/60">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold leading-tight">会话输出</h2>
              <Chip tone="neutral">{history.length} 条</Chip>
            </div>
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <StatusDot tone={running ? "info" : "idle"} />
              <span>{running ? (stopping ? "正在停止" : "命令运行中") : "空闲"}</span>
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
            {history.length === 0 ? (
              <div className="flex h-full min-h-[320px] items-center justify-center">
                <EmptyState
                  icon={Terminal}
                  title="等待命令输出"
                  bordered={false}
                  action={
                    <span className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                      输入命令并按回车执行，输出会保留在当前会话中。
                    </span>
                  }
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {history.map((item) => (
                  <ShellHistoryItem
                    key={item.id}
                    item={item}
                    now={now}
                    onRecall={() => recallCommand(item.command)}
                    onCopy={() => void copyOutput(item)}
                  />
                ))}
              </div>
            )}
          </div>
        </SurfacePanel>

        <CommandComposer
          cwdInput={cwdInput}
          historyCursor={historyCursor}
          input={input}
          running={running}
          stopping={stopping}
          onClear={clearHistory}
          onCommandHistory={walkCommandHistory}
          onCwdChange={setCwdInput}
          onInputChange={(next) => {
            setInput(next)
            if (historyCursor !== null) setHistoryCursor(null)
          }}
          onRun={() => void runCommand()}
          onStop={stopCommand}
        />
      </div>
    </div>
  )
}

function SessionSummary({
  commandHistoryCount,
  historyCount,
  running,
  stopping,
}: {
  commandHistoryCount: number
  historyCount: number
  running: boolean
  stopping: boolean
}) {
  return (
    <section className="shrink-0 rounded-lg border border-border/60 bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <StatusDot tone={running ? "info" : "idle"} />
          <span className="font-medium">
            {running ? (stopping ? "停止中" : "运行中") : "本地命令面板"}
          </span>
          <span className="text-muted-foreground">
            {historyCount ? `${historyCount} 条会话记录` : "输出仅保留在当前会话"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <Chip tone="neutral">↑↓ 历史</Chip>
          <Chip tone="neutral">Enter 执行</Chip>
          <Chip tone="neutral">最近 {commandHistoryCount}/50</Chip>
        </div>
      </div>
    </section>
  )
}

function CommandComposer({
  cwdInput,
  historyCursor,
  input,
  running,
  stopping,
  onClear,
  onCommandHistory,
  onCwdChange,
  onInputChange,
  onRun,
  onStop,
}: {
  cwdInput: string
  historyCursor: number | null
  input: string
  running: boolean
  stopping: boolean
  onClear: () => void
  onCommandHistory: (direction: "prev" | "next") => void
  onCwdChange: (value: string) => void
  onInputChange: (value: string) => void
  onRun: () => void
  onStop: () => void
}) {
  return (
    <section className="shrink-0 rounded-lg border border-border/60 bg-card p-4">
      <div className="flex flex-col gap-4">
        <label className="grid gap-2 text-[13px] text-muted-foreground sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center">
          <span>工作目录</span>
          <Input
            value={cwdInput}
            onChange={(e) => onCwdChange(e.target.value)}
            placeholder="留空使用 App 默认目录"
            className="h-9 border-border/60 bg-background font-mono text-xs"
          />
        </label>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
              $
            </span>
            <Input
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  onRun()
                  return
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault()
                  onCommandHistory("prev")
                  return
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  onCommandHistory("next")
                }
              }}
              placeholder={running ? "当前命令运行中，可先输入下一条…" : "输入命令…"}
              className="h-10 border-border/60 bg-background pl-7 font-mono"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              className="flex-1 gap-1.5 sm:flex-none"
              disabled={running || !input.trim()}
              onClick={onRun}
            >
              <Play className="h-4 w-4" />
              执行
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!running || stopping}
              onClick={onStop}
              aria-label="停止当前命令"
            >
              <Square className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={running}
              onClick={onClear}
              aria-label="清空"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span>
            {running
              ? stopping
                ? "正在停止当前命令…"
                : "当前命令运行中，可先编辑下一条命令。"
              : "准备执行本地 Shell 命令。"}
          </span>
          {historyCursor !== null && <span>正在浏览历史命令。</span>}
        </div>
      </div>
    </section>
  )
}

function ShellHistoryItem({
  item,
  now,
  onRecall,
  onCopy,
}: {
  item: HistoryItem
  now: number
  onRecall: () => void
  onCopy: () => void
}) {
  const outputLines = item.lines.filter(
    (line): line is Extract<ShellLine, { type: "stdout" | "stderr" }> =>
      line.type === "stdout" || line.type === "stderr",
  )
  const footerLines = item.lines.filter(
    (line): line is Extract<ShellLine, { type: "exit" | "error" }> =>
      line.type === "exit" || line.type === "error",
  )

  return (
    <article className="group rounded-md border border-border/60 bg-card p-3 transition-colors hover:border-foreground/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 items-start gap-2 font-mono text-sm">
            <span className="select-none text-primary">$</span>
            <span className="min-w-0 break-all text-foreground">{item.command}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={statusTone(item)}>{statusLabel(item)}</Chip>
            <Chip tone="neutral">{formatDuration((item.endedAt ?? now) - item.startedAt)}</Chip>
            {item.cwd && (
              <Chip tone="neutral" className="max-w-full rounded-md">
                <span className="truncate">cwd: {item.cwd}</span>
              </Chip>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconAction label="放回输入框" onClick={onRecall}>
            <RotateCcw className="h-3.5 w-3.5" />
          </IconAction>
          <IconAction label="复制输出" onClick={onCopy}>
            <ClipboardCopy className="h-3.5 w-3.5" />
          </IconAction>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border/50 bg-muted/20 px-3 py-2 font-mono text-sm">
        {outputLines.length === 0 ? (
          <div className="py-2 text-[13px] text-muted-foreground">
            {item.finished ? "无输出" : "等待输出…"}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {outputLines.map((line, idx) => (
              <ShellLineView key={idx} line={line} />
            ))}
          </div>
        )}
        {footerLines.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 border-t border-border/50 pt-2">
            {footerLines.map((line, idx) => (
              <ShellLineView key={idx} line={line} />
            ))}
          </div>
        )}
        {!item.finished && (
          <span className="mt-2 block animate-pulse text-muted-foreground">运行中…</span>
        )}
      </div>
    </article>
  )
}

function IconAction({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
  )
}

function ShellLineView({ line }: { line: ShellLine }) {
  if (line.type === "stdout") {
    return <pre className="whitespace-pre-wrap text-foreground/90">{line.text}</pre>
  }
  if (line.type === "stderr") {
    return <pre className="whitespace-pre-wrap text-destructive">{line.text}</pre>
  }
  if (line.type === "exit") {
    return (
      <span className={cn("text-xs", line.code === 0 ? "text-success" : "text-destructive")}>
        [exit {line.code}]
      </span>
    )
  }
  return <span className="text-destructive">{line.message}</span>
}

function statusLabel(item: HistoryItem): string {
  if (item.status === "running") return "运行中"
  if (item.status === "stopped") return "已停止"
  if (item.status === "error") return "执行错误"
  return `exit ${item.exitCode ?? "?"}`
}

function statusTone(item: HistoryItem): Tone {
  if (item.status === "running") return "info"
  if (item.status === "stopped") return "warn"
  if (item.status === "error") return "error"
  return item.exitCode === 0 ? "ok" : "error"
}

function formatDuration(ms: number): string {
  const safe = Math.max(0, ms)
  if (safe < 1000) return `${safe}ms`
  const seconds = safe / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}m ${rest}s`
}

function PageHeader() {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">终端</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            本地命令面板。适合执行短命令与脚本，输出仅在当前会话保留。
          </p>
        </div>
      </div>
    </div>
  )
}
