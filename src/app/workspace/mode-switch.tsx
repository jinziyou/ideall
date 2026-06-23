"use client"

// 顶栏左上角模式切换 (Trae 风格下拉): 本地 ⇄ 连接。
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/components/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useMode, setMode } from "./store"
import type { WsMode } from "./types"

const MODES: { id: WsMode; label: string; hint: string; dot: string }[] = [
  { id: "local", label: "本地", hint: "我的 · 订阅 · 关注 —— 只存本机", dot: "bg-primary" },
  { id: "connected", label: "连接", hint: "资讯 · 社区 · 工具 · AI —— 联网", dot: "bg-spoke-community" },
]

export default function ModeSwitch() {
  const mode = useMode()
  const cur = MODES.find((m) => m.id === mode) ?? MODES[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-shell px-2 py-1 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <span className={cn("h-2 w-2 rounded-full", cur.dot)} />
          {cur.label}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {MODES.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => setMode(m.id)}
            className="flex items-start gap-2"
          >
            <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", m.dot)} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {m.label}
                {m.id === mode && <Check className="h-3.5 w-3.5 text-primary" />}
              </span>
              <span className="block text-xs text-muted-foreground">{m.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
