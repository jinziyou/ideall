"use client"

// 活动栏 (IDE 式标签工作区侧栏的图标轨): 按当前「本地/连接」模式视图过滤展示模块图标 (+ crossMode 跨模式模块);
// 顶栏 ModeSwitch 切换视图。点模块图标 = 切到该模块并展开二级侧栏 (再点已激活模块 = 收起侧栏);
// 「工作区」钮紧随「我的」(home) 下方; 本地模式「插件」+「应用」在轨底 (分隔线下方, 应用在插件之下)。
// 设置 / AI 对话入口在顶栏 (Trae 式)。

import { Fragment } from "react"
import { Boxes } from "lucide-react"
import { cn } from "@/lib/utils"
import { useNodeCount } from "@/shell/use-node-count"
import { moduleById, modulesForMode } from "./modules"
import { isPluginModule } from "./plugin-entries"
import {
  useActiveModule,
  useMode,
  useSidebarCollapsed,
  toggleModule,
  toggleWorkspace,
} from "./store"

function BarDivider() {
  return <div aria-hidden className="my-0.5 h-px w-8 shrink-0 bg-border" />
}

export default function ActivityBar() {
  const activeModule = useActiveModule()
  const mode = useMode()
  const sidebarCollapsed = useSidebarCollapsed()
  const workspaceActive = activeModule === "agent"
  const { count, flash } = useNodeCount()
  const listed = modulesForMode(mode)
  const pluginsMod = listed.find((m) => m.id === "plugins")
  const appsMod = listed.find((m) => m.id === "apps")
  const topModules = listed.filter((m) => m.id !== "plugins" && m.id !== "apps")
  const stray =
    activeModule !== "agent" &&
    !isPluginModule(activeModule) &&
    activeModule !== "plugins" &&
    activeModule !== "apps" &&
    !listed.some((m) => m.id === activeModule)
      ? moduleById(activeModule)
      : null
  const hasHome = topModules.some((m) => m.id === "home")
  const pluginsActive = activeModule === "plugins" || isPluginModule(activeModule)

  const workspaceButton = (
    <button
      key="workspace"
      type="button"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={toggleWorkspace}
      aria-pressed={workspaceActive}
      aria-expanded={workspaceActive && !sidebarCollapsed}
      className={cn(
        "relative flex w-full flex-col items-center justify-center gap-0.5 rounded-shell py-1.5 text-[11px] font-medium transition-colors",
        workspaceActive
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {workspaceActive && (
        <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <Boxes className={cn("h-[1.2rem] w-[1.2rem]", workspaceActive ? "text-primary" : undefined)} />
      <span className="leading-none">工作区</span>
    </button>
  )

  const moduleButton = (
    m: ReturnType<typeof moduleById>,
    opts?: { forceActive?: boolean },
  ) => {
    const Icon = m.icon
    const active = opts?.forceActive ?? activeModule === m.id
    const badge = m.id === "home" ? count : undefined
    return (
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
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
          <Icon className={cn("h-[1.2rem] w-[1.2rem]", active ? "text-primary" : m.colorClass)} />
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
  }

  return (
    <aside className="hidden h-full w-14 shrink-0 flex-col items-center gap-1 border-r bg-card px-2 py-2.5 md:flex">
      <div className="flex w-full flex-col gap-1">
        {topModules.map((m) => (
          <Fragment key={m.id}>
            {moduleButton(m)}
            {m.id === "home" && workspaceButton}
          </Fragment>
        ))}
        {!hasHome && workspaceButton}
        {pluginsMod && (
          <>
            <BarDivider />
            {moduleButton(pluginsMod, { forceActive: pluginsActive })}
            {appsMod && moduleButton(appsMod)}
          </>
        )}
        {!pluginsMod && appsMod && (
          <>
            <BarDivider />
            {moduleButton(appsMod)}
          </>
        )}
      </div>
      {stray && (
        <div className="mt-auto flex w-full flex-col gap-1">
          <BarDivider />
          {moduleButton(stray)}
        </div>
      )}
    </aside>
  )
}
