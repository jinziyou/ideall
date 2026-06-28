"use client"

// 活动栏 (IDE 式标签工作区侧栏的图标轨): 按当前模式渲染模块图标 (+ crossMode 跨模式模块)。
// logo / 模式切换 / 设置 / 账户 已上移到顶边栏 (top-bar)。
// 点图标 = 切到该模块并展开二级侧栏 (再点同模块收起)；不直接开标签 (由侧栏条目开)。
// 「工具」: 本地/连接活动栏均展示, 打开不翻 mode (与 AI 区段同类)。
// 「AI」钮: 仅本地(local)模式, 放在「我的」(home) 紧下方; 连接(connected)模式不展示。

import { Fragment } from "react"
import { Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import { useNodeCount } from "@/shell/use-node-count"
import { modulesForMode } from "./modules"
import { useActiveModule, useMode, toggleModule, openHome, openAiSettings } from "./store"

export default function ActivityBar() {
  const activeModule = useActiveModule()
  const mode = useMode()
  // AI 钮高亮 = 任一 AI 区段标签激活 (activeModule==="agent")。
  const aiActive = activeModule === "agent"
  const { count, flash } = useNodeCount()
  const modules = modulesForMode(mode)

  // AI 钮: 仅本地模式, 渲染在「我的」下方 (见下方 home 分支); 连接模式不展示。
  const aiButton = (
    <button
      key="ai"
      type="button"
      onClick={openAiSettings}
      title="AI"
      aria-current={aiActive ? "true" : undefined}
      className={cn(
        "relative flex w-full flex-col items-center justify-center gap-0.5 rounded-shell py-1.5 text-[10px] font-medium transition-colors",
        aiActive
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {aiActive && (
        <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <Bot className={cn("h-[1.2rem] w-[1.2rem]", aiActive ? "text-primary" : undefined)} />
      <span className="leading-none">AI</span>
    </button>
  )

  return (
    <aside className="hidden h-full w-14 shrink-0 flex-col items-center gap-1 border-r bg-card px-2 py-2.5 md:flex">
      {modules.map((m) => {
        const Icon = m.icon
        const active = activeModule === m.id
        const badge = m.id === "home" ? count : undefined
        return (
          <Fragment key={m.id}>
            <button
              type="button"
              onClick={() => (m.id === "home" ? openHome() : toggleModule(m.id))}
              title={m.label}
              aria-current={active ? "true" : undefined}
              className={cn(
                "relative flex w-full flex-col items-center justify-center gap-0.5 rounded-shell py-1.5 text-[10px] font-medium transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {active && (
                <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
              )}
              <span className="relative">
                <Icon
                  className={cn("h-[1.2rem] w-[1.2rem]", active ? "text-primary" : m.colorClass)}
                />
                {typeof badge === "number" && badge > 0 && (
                  <span
                    className={cn(
                      "absolute -right-2 -top-1.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-pop px-1 text-[9px] font-bold tabular-nums text-pop-foreground",
                      flash && "animate-flowback motion-reduce:animate-none",
                    )}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
              <span className="leading-none">{m.label}</span>
            </button>
            {/* AI 紧随「我的」下方 (仅 local 模式; 连接模式无「我的」→ 不展示 AI) */}
            {m.id === "home" && aiButton}
          </Fragment>
        )
      })}
    </aside>
  )
}
