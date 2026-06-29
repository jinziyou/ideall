"use client"

import type { ComponentType } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bot, Hexagon } from "lucide-react"
import { cn } from "@/lib/utils"
import { HOME_HREF, HOME_LABEL, SPOKES } from "@/shell/nav-config"
import { useNodeCount } from "./use-node-count"

const AGENT_HREF = "/home/agent"

const isAgentActive = (p: string) => p === AGENT_HREF || p.startsWith(AGENT_HREF + "/")

type Tab = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
  iconClass?: string
  isActive: (pathname: string) => boolean
}

const isHomeActive = (p: string) =>
  p === HOME_HREF ||
  (p.startsWith(HOME_HREF + "/") && p !== AGENT_HREF && !p.startsWith(AGENT_HREF + "/"))

const TABS: Tab[] = [
  { href: HOME_HREF, label: HOME_LABEL, icon: Hexagon, isActive: isHomeActive },
  ...SPOKES.map((s) => ({
    href: s.href,
    label: s.label,
    icon: s.icon,
    iconClass: s.dot?.replace("bg-", "text-"),
    isActive: (p: string) => p === s.href || p.startsWith(s.href + "/"),
  })),
]

function TabItem({
  tab,
  pathname,
  badge,
  flash,
}: {
  tab: Tab
  pathname: string
  badge?: number | null
  flash?: boolean
}) {
  const active = tab.isActive(pathname)
  const Icon = tab.icon
  return (
    <Link
      href={tab.href}
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
    </Link>
  )
}

/**
 * 移动端底部标签栏 (md:hidden) —— 我的 / 资讯 / [中央 AI] / 社区 / 工具。
 * 中央按钮直达 AI 对话 (/home/agent → 呼出右侧/全屏对话面板)。
 * 注: 桌面活动栏「AI」钮当前打开的是「AI 设置」标签 (非对话), 两端目的地暂不一致 ——
 *     待 AI 主入口语义统一 (均首呼对话) 后再对齐, 见导航优化方案决策 #4。
 * 命令台在移动端由顶栏的 CommandTrigger 提供, 不再与中央按钮混用。
 */
export default function BottomTabBar() {
  const pathname = usePathname()
  const { count, flash } = useNodeCount()
  const agentActive = isAgentActive(pathname)

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around gap-1 border-t bg-card/95 px-1 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1 backdrop-blur md:hidden">
      <TabItem tab={TABS[0]} pathname={pathname} badge={count} flash={flash} />
      <TabItem tab={TABS[1]} pathname={pathname} />
      <Link
        href={AGENT_HREF}
        aria-label="AI 助手"
        aria-current={agentActive ? "page" : undefined}
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
      </Link>
      <TabItem tab={TABS[2]} pathname={pathname} />
      <TabItem tab={TABS[3]} pathname={pathname} />
    </nav>
  )
}
