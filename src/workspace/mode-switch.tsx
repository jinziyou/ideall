"use client"

// 数据来源镜头切换: 本地 ⇄ 连接。它只过滤文件位置，不改变当前工作区类型。
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { useMode, setMode } from "./store"
import type { WsMode } from "./types"

const MODES: { id: WsMode; label: string; dot: string }[] = [
  { id: "local", label: "本地", dot: "bg-primary" },
  { id: "connected", label: "连接", dot: "bg-spoke-community" },
]

export default function ModeSwitch({ className }: { className?: string }) {
  const mode = useMode()
  const router = useRouter()

  return (
    <div
      role="group"
      aria-label="数据来源模式"
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-shell bg-secondary/60 p-0.5",
        className,
      )}
    >
      {MODES.map((m) => {
        const active = m.id === mode
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={active}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              setMode(m.id)
              if (m.id !== mode) router.replace(m.id === "local" ? "/home" : "/info")
            }}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-shell px-2.5 py-1 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full transition-colors",
                active ? m.dot : "bg-muted-foreground/40",
              )}
            />
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
