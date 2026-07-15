"use client"

import type { ComponentType } from "react"
import { Bot, Hexagon } from "lucide-react"
import { cn } from "@/lib/utils"
import { AGENT_TARGET, FOLLOWING_TARGET, HOME_LABEL, HOME_TARGET, SPOKES } from "@/shell/nav-config"
import { MODULE_META } from "@/workspace/module-meta"
import {
  openTarget,
  useActiveId,
  useActiveModule,
  useActiveRootId,
  useRightPanelOpen,
  useTabs,
  type OpenTarget,
} from "@/workspace/store"
import type { ModuleId } from "@/workspace/types"
import TabsSheet from "./tabs-sheet"
import { useNodeCount } from "./use-node-count"

type PathTarget = Extract<OpenTarget, { type: "path" }>
type NavigationState = {
  activePath: string | null
  activeModule: ModuleId
  activeRootId: string
}

type Tab = {
  target: PathTarget
  label: string
  icon: ComponentType<{ className?: string }>
  iconClass?: string
  isActive: (state: NavigationState) => boolean
}

const isAtOrBelow = (activePath: string | null, target: PathTarget) =>
  Boolean(activePath && (activePath === target.path || activePath.startsWith(`${target.path}/`)))

const isHomeActive = ({ activePath, activeModule, activeRootId }: NavigationState) =>
  activePath
    ? isAtOrBelow(activePath, HOME_TARGET) && !isAtOrBelow(activePath, FOLLOWING_TARGET)
    : activeRootId === "home" && activeModule !== "subscriptions"

const TABS: Tab[] = [
  { target: HOME_TARGET, label: HOME_LABEL, icon: Hexagon, isActive: isHomeActive },
  {
    // 关注流 = 「发现经关注汇入我的」的汇合点, 移动端最高频目的地 → 提为底栏一级入口
    // (置换出「工具」—— 移动端外部启动器价值最低, 仍可经浏览抽屉「发现」组 / ⌘K 到达)。
    target: FOLLOWING_TARGET,
    label: MODULE_META.subscriptions.label,
    icon: MODULE_META.subscriptions.icon,
    iconClass: MODULE_META.subscriptions.tintClass,
    isActive: ({ activePath, activeModule }) =>
      isAtOrBelow(activePath, FOLLOWING_TARGET) ||
      (!activePath && activeModule === "subscriptions"),
  },
  ...SPOKES.flatMap((spoke): Tab[] => {
    if (spoke.id === "tool" || spoke.target.type !== "path") return []
    const target = spoke.target
    return [
      {
        target,
        label: spoke.label,
        icon: spoke.icon,
        iconClass: spoke.dot?.replace("bg-", "text-"),
        isActive: ({ activePath, activeModule }) =>
          isAtOrBelow(activePath, target) || (!activePath && activeModule === spoke.id),
      },
    ]
  }),
]

function TabItem({
  tab,
  navigationState,
  badge,
  flash,
}: {
  tab: Tab
  navigationState: NavigationState
  badge?: number | null
  flash?: boolean
}) {
  const active = tab.isActive(navigationState)
  const Icon = tab.icon
  return (
    <button
      type="button"
      onClick={() => openTarget(tab.target)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-1 flex-col items-center gap-0.5 rounded-shell py-1 text-[10px] font-medium",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <span className="relative">
        <Icon className={cn("h-[1.3rem] w-[1.3rem]", !active && tab.iconClass)} />
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
      <span className="leading-none">{tab.label}</span>
    </button>
  )
}

/**
 * 移动端底部标签栏 (md:hidden) —— 我的 / 关注 / [中央 AI] / 资讯 / 社区 / 标签。
 * 「关注」(关注流) 是发现内容汇入「我的」的汇合点 = 移动端最高频目的地, 占一级入口;
 * 「工具」退居浏览抽屉「发现」组与 ⌘K。最右「标签」为多标签切换器触发 (拇指区, 见 TabsSheet)。
 * 中央按钮直达 AI 对话 (呼出右侧/全屏对话面板), 与桌面顶栏 AI 侧栏按钮语义一致
 * (两端 AI 主入口均首呼对话; 管理面走对话栏齿轮 / /ai 深链)。
 * 命令面板在移动端由顶栏的 CommandTrigger 提供, 不再与中央按钮混用。
 */
export default function BottomTabBar() {
  const tabs = useTabs()
  const activeId = useActiveId()
  const activePath = tabs.find((tab) => tab.id === activeId)?.navigationPath ?? null
  const activeModule = useActiveModule()
  const activeRootId = useActiveRootId()
  const navigationState = { activePath, activeModule, activeRootId }
  const { count, flash } = useNodeCount()
  const agentActive = useRightPanelOpen()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around gap-1 border-t bg-card/95 px-1 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1 backdrop-blur md:hidden">
      <TabItem tab={TABS[0]} navigationState={navigationState} badge={count} flash={flash} />
      <TabItem tab={TABS[1]} navigationState={navigationState} />
      <button
        type="button"
        onClick={() => openTarget(AGENT_TARGET)}
        aria-label="AI 智能体"
        aria-pressed={agentActive}
        className="flex shrink-0 flex-col items-center justify-end gap-0.5 self-stretch px-1"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-shell bg-primary text-primary-foreground">
          <Bot className="h-5 w-5" />
        </span>
        <span
          className={cn(
            "text-[10px] font-medium leading-none",
            agentActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          AI
        </span>
      </button>
      <TabItem tab={TABS[2]} navigationState={navigationState} />
      <TabItem tab={TABS[3]} navigationState={navigationState} />
      {/* 多标签切换器 (底部弹出 = 拇指区; 触发器从顶栏移入底栏)。 */}
      <TabsSheet variant="bar" />
    </nav>
  )
}
