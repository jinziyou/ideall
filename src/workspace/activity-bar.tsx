"use client"

// 活动栏 (IDE 式标签工作区侧栏的图标轨): 按当前模式渲染模块图标。
// logo / 模式切换 / 设置 / 账户 已上移到顶边栏 (top-bar)。
// 点图标 = 切到该模块并展开二级侧栏 (再点同模块收起)；不直接开标签 (由侧栏条目开)。

import { cn } from "@/lib/utils"
import { useNodeCount } from "@/shell/use-node-count"
import { modulesForMode } from "./modules"
import { useActiveModule, useMode, toggleModule } from "./store"

export default function ActivityBar() {
  const activeModule = useActiveModule()
  const mode = useMode()
  const { count, flash } = useNodeCount()
  const modules = modulesForMode(mode)

  return (
    <aside className="hidden h-full w-14 shrink-0 flex-col items-center gap-1 border-r bg-card px-2 py-2.5 md:flex">
      {modules.map((m) => {
        const Icon = m.icon
        const active = activeModule === m.id
        const badge = m.id === "home" ? count : undefined
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => toggleModule(m.id)}
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
        )
      })}
    </aside>
  )
}
