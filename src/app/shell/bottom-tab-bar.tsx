"use client"

import type { ComponentType } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Hexagon, Sparkles } from "lucide-react"
import { cn } from "@/components/lib/utils"
import { HUB_HREF, HUB_LABEL, SPOKES } from "@/app/nav/nav-config"
import { useHubCount } from "./use-hub-count"
import { openCommandPalette } from "./command-palette"

const AGENT_HREF = "/home/agent"

type Tab = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
  iconClass?: string
  isActive: (pathname: string) => boolean
}

const isHubActive = (p: string) =>
  p === HUB_HREF ||
  (p.startsWith(HUB_HREF + "/") && p !== AGENT_HREF && !p.startsWith(AGENT_HREF + "/"))

const TABS: Tab[] = [
  { href: HUB_HREF, label: HUB_LABEL, icon: Hexagon, isActive: isHubActive },
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
        "flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 text-[10px] font-medium",
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
 * 移动端底部标签栏 (md:hidden) —— 我的 / 资讯 / [中央 ✦ 命令台] / 社区 / 工具。
 * 中央按钮唤起 ⌘K 浮层命令台 (方案 3 移动形态)。
 */
export default function BottomTabBar() {
  const pathname = usePathname()
  const { count, flash } = useHubCount()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around gap-1 border-t bg-card/95 px-1 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1 backdrop-blur md:hidden">
      <TabItem tab={TABS[0]} pathname={pathname} badge={count} flash={flash} />
      <TabItem tab={TABS[1]} pathname={pathname} />
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label="命令台 / AI (⌘K)"
        className="-mt-4 flex h-12 w-12 shrink-0 items-center justify-center self-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30"
      >
        <Sparkles className="h-5 w-5" />
      </button>
      <TabItem tab={TABS[2]} pathname={pathname} />
      <TabItem tab={TABS[3]} pathname={pathname} />
    </nav>
  )
}
