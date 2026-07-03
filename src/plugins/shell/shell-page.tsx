"use client"

import * as React from "react"
import { Play, RotateCcw, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { EmptyState } from "@/ui/empty-state"
import { Terminal } from "lucide-react"
import { executeStreaming, type ShellLine } from "./shell-commands"

type HistoryItem = {
  id: string
  command: string
  lines: ShellLine[]
  finished: boolean
}

export default function ShellPage() {
  const [history, setHistory] = React.useState<HistoryItem[]>([])
  const [input, setInput] = React.useState("")
  const [running, setRunning] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const killRef = React.useRef<(() => void) | null>(null)

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [history])

  React.useEffect(() => {
    return () => {
      if (killRef.current) {
        killRef.current()
        killRef.current = null
      }
    }
  }, [])

  if (!isTauri()) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader />
        <EmptyState icon={Terminal} title="本地终端仅在桌面 App 中可用" bordered />
      </div>
    )
  }

  const runCommand = async () => {
    const command = input.trim()
    if (!command || running) return
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const item: HistoryItem = { id, command, lines: [], finished: false }
    setHistory((h) => [...h, item])
    setInput("")
    setRunning(true)

    try {
      killRef.current = await executeStreaming(command, (line) => {
        setHistory((h) => {
          const target = h.find((x) => x.id === id)
          if (!target) return h
          const next: HistoryItem = {
            ...target,
            lines: [...target.lines, line],
            finished: line.type === "exit" || line.type === "error",
          }
          return h.map((x) => (x.id === id ? next : x))
        })
      })
    } catch (e) {
      setHistory((h) =>
        h.map((x) =>
          x.id === id
            ? { ...x, lines: [...x.lines, { type: "error", message: String(e) }], finished: true }
            : x,
        ),
      )
      setRunning(false)
    }
  }

  const clearHistory = () => {
    if (killRef.current) {
      killRef.current()
      killRef.current = null
    }
    setHistory([])
    setRunning(false)
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4">
      <PageHeader />

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60 bg-black/90 p-4 font-mono text-sm"
      >
        {history.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground/60">
            输入命令并按回车执行…
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {history.map((item) => (
              <div key={item.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-emerald-400">
                  <span className="select-none">$</span>
                  <span>{item.command}</span>
                </div>
                <div className="flex flex-col gap-0.5 pl-4">
                  {item.lines.map((line, idx) => (
                    <ShellLineView key={idx} line={line} />
                  ))}
                  {!item.finished && (
                    <span className="text-muted-foreground/60 animate-pulse">运行中…</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runCommand()
          }}
          placeholder="输入命令…"
          disabled={running}
          className="h-10 flex-1 border-border/60 bg-background font-mono"
        />
        <Button
          type="button"
          size="icon"
          disabled={running || !input.trim()}
          onClick={runCommand}
          aria-label="执行"
        >
          <Play className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={running}
          onClick={clearHistory}
          aria-label="清空"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
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
      <span className={cn("text-xs", line.code === 0 ? "text-emerald-400" : "text-destructive")}>
        [exit {line.code}]
      </span>
    )
  }
  return <span className="text-destructive">{line.message}</span>
}

function PageHeader() {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">终端</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            在 ideall 内执行本地 Shell 命令。输出仅在当前会话保留。
          </p>
        </div>
      </div>
    </div>
  )
}
