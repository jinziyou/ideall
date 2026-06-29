"use client"

// 活动栏 (IDE 式标签工作区侧栏的图标轨): 扁平单轨 —— 全部模块同时可见, 按 mode 字段视觉分两组
// (本机/我的 · 连接/发现), 组间一条细分隔。不再有「本地/连接」模式开关 (那曾藏起一半入口并会随标签自动翻转)。
// 点模块图标 = 切到该模块并展开二级侧栏 (再点已激活模块 = 收起侧栏, 含「我的」语义统一);
// 落地面板以「预览」(transient) 方式开, 点遍多个模块只复用单一预览槽, 不堆常驻标签 (详见 store)。
// 「AI」钮: 紧随「我的」(home) 下方, 始终可见。

import { Fragment } from "react"
import { Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import { useNodeCount } from "@/shell/use-node-count"
import { MODULE_GROUPS } from "./modules"
import { useActiveModule, useSidebarCollapsed, toggleModule, toggleAiSidebar } from "./store"

export default function ActivityBar() {
  const activeModule = useActiveModule()
  const sidebarCollapsed = useSidebarCollapsed()
  // AI 钮高亮 = 任一 AI 区段标签激活 (activeModule==="agent")。
  const aiActive = activeModule === "agent"
  const { count, flash } = useNodeCount()

  const aiButton = (
    <button
      key="ai"
      type="button"
      onClick={toggleAiSidebar}
      aria-current={aiActive ? "true" : undefined}
      aria-expanded={aiActive && !sidebarCollapsed}
      className={cn(
        "relative flex w-full flex-col items-center justify-center gap-0.5 rounded-shell py-1.5 text-[11px] font-medium transition-colors",
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
      {MODULE_GROUPS.map((group, gi) => (
        <Fragment key={group.id}>
          {/* 组间分隔: 把「本机/我的」与「连接/发现」分成两簇 (取代旧的模式开关)。 */}
          {gi > 0 && (
            <div className="my-1 h-px w-7 shrink-0 rounded-full bg-border" aria-hidden="true" />
          )}
          {group.modules.map((m) => {
            const Icon = m.icon
            const active = activeModule === m.id
            const badge = m.id === "home" ? count : undefined
            return (
              <Fragment key={m.id}>
                <button
                  type="button"
                  onClick={() => toggleModule(m.id)}
                  aria-current={active ? "true" : undefined}
                  aria-expanded={active && !sidebarCollapsed}
                  className={cn(
                    "relative flex w-full flex-col items-center justify-center gap-0.5 rounded-shell py-1.5 text-[11px] font-medium transition-colors",
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
                      className={cn(
                        "h-[1.2rem] w-[1.2rem]",
                        active ? "text-primary" : m.colorClass,
                      )}
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
                {/* AI 紧随「我的」(home) 下方, 始终可见 */}
                {m.id === "home" && aiButton}
              </Fragment>
            )
          })}
        </Fragment>
      ))}
    </aside>
  )
}
