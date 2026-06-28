"use client"

// 顶栏左上角模式切换 (Trae 式分段切换按钮): 本地 ⇄ 连接。
// 两段并排, 激活段抬升 (bg-background + 阴影); 点另一段即切模式。各段 hint 经 title 悬浮提示保留。
import { cn } from "@/lib/utils"
import { useMode, setMode } from "./store"
import type { WsMode } from "./types"

const MODES: { id: WsMode; label: string; hint: string; dot: string }[] = [
  {
    id: "local",
    label: "本地",
    hint: "我的 · 关注 · 应用 · 工具 —— 本机数据 + 常用工具",
    dot: "bg-primary",
  },
  { id: "connected", label: "连接", hint: "资讯 · 社区 —— 联网发现", dot: "bg-spoke-community" },
]

export default function ModeSwitch() {
  const mode = useMode()

  return (
    <div
      role="tablist"
      aria-label="工作区模式"
      className="flex shrink-0 items-center gap-0.5 rounded-shell bg-secondary/60 p-0.5"
    >
      {MODES.map((m) => {
        const active = m.id === mode
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={m.hint}
            onClick={() => setMode(m.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-shell px-2.5 py-1 text-sm font-medium transition-colors",
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
