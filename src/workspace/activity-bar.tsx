"use client"

// 活动栏 (IDE 式标签工作区侧栏的图标轨): 按当前「本地/连接」模式视图过滤展示模块图标 (+ crossMode 跨模式模块);
// 顶栏 ModeSwitch 切换视图。点模块图标 = 切到该模块并展开二级侧栏 (再点已激活模块 = 收起侧栏);
// 落地面板以「预览」(transient) 方式开, 点遍多个模块只复用单一预览槽, 不堆常驻标签 (详见 store)。
// 「AI」钮 = 对话开关 (与移动底栏中央 AI 钮语义一致, 均首呼对话): 开/关右侧对话栏, 高亮随栏开合;
//   AI 管理面 (设置/MCP/Skills/规则) 是次级入口 —— 对话栏齿轮 / /ai 深链。
//   mode-中性, 两模式都可呼出 —— 本地模式紧随「我的」(home) 下方, 连接模式落在轨末。

import { Fragment } from "react"
import { Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import { useNodeCount } from "@/shell/use-node-count"
import { moduleById, modulesForMode } from "./modules"
import {
  useActiveModule,
  useMode,
  useRightPanelOpen,
  useSidebarCollapsed,
  toggleModule,
  toggleRightPanel,
} from "./store"

export default function ActivityBar() {
  const activeModule = useActiveModule()
  const mode = useMode()
  const sidebarCollapsed = useSidebarCollapsed()
  // AI 钮 = 对话栏开关, 高亮随右栏开合 (与 activeModule 解耦; 管理标签的高亮归各自标签)。
  const aiActive = useRightPanelOpen()
  const { count, flash } = useNodeCount()
  const listed = modulesForMode(mode)
  // 激活/打开标签不再翻 mode (见 store): 激活模块可能属于另一模式视图 ——
  // 把它附加到轨末 (分隔线之后), 保证「我在哪」的高亮永不消失; 点击它 (toggleModule) 才显式切视图。
  const stray =
    activeModule !== "agent" && !listed.some((m) => m.id === activeModule)
      ? moduleById(activeModule)
      : null
  const modules = listed
  const hasHome = modules.some((m) => m.id === "home")

  const aiButton = (
    <button
      key="ai"
      type="button"
      onClick={toggleRightPanel}
      aria-pressed={aiActive}
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

  const moduleButton = (m: ReturnType<typeof moduleById>) => {
    const Icon = m.icon
    const active = activeModule === m.id
    const badge = m.id === "home" ? count : undefined
    return (
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
      {modules.map((m) => (
        <Fragment key={m.id}>
          {moduleButton(m)}
          {/* AI 紧随「我的」(home) 下方 (本地模式) */}
          {m.id === "home" && aiButton}
        </Fragment>
      ))}
      {/* 连接模式无「我的」锚点 → AI 钮落在轨末, 保证两模式都能呼出 */}
      {!hasHome && aiButton}
      {/* 激活模块属于另一模式视图: 附加到分隔线下, 保证高亮不消失; 点击才显式切视图 */}
      {stray && (
        <>
          <div aria-hidden className="my-0.5 h-px w-8 shrink-0 bg-border" />
          {moduleButton(stray)}
        </>
      )}
    </aside>
  )
}
