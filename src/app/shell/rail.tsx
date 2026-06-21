"use client"

import type { ComponentType } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bot, Command, Hexagon } from "lucide-react"
import { cn } from "@/components/lib/utils"
import { WonitaMark } from "@/components/shared/wonita-mark"
import { HUB_HREF, HUB_LABEL, SPOKES } from "@/app/nav/nav-config"
import { useHubCount } from "./use-hub-count"
import { openCommandPalette } from "./command-palette"
import ThemeToggle from "./theme-toggle"
import AccountMenu from "./account-menu"
import LocalDeviceChip from "./local-device-chip"

const AGENT_HREF = "/home/agent"

type RailEntry = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** 非激活时的图标着色 (spoke 分类色, 由 bg-* 推出 text-*) */
  iconClass?: string
  isActive: (pathname: string) => boolean
}

// 「我的」涵盖 /home 全部子区, 但 AI 助手 (/home/agent) 单列一项, 故从中排除。
const isHubActive = (p: string) =>
  p === HUB_HREF ||
  (p.startsWith(HUB_HREF + "/") && p !== AGENT_HREF && !p.startsWith(AGENT_HREF + "/"))

const ENTRIES: RailEntry[] = [
  { href: HUB_HREF, label: HUB_LABEL, icon: Hexagon, isActive: isHubActive },
  ...SPOKES.map((s) => ({
    href: s.href,
    label: s.label,
    icon: s.icon,
    iconClass: s.dot?.replace("bg-", "text-"),
    isActive: (p: string) => p === s.href || p.startsWith(s.href + "/"),
  })),
  {
    href: AGENT_HREF,
    label: "AI",
    icon: Bot,
    isActive: (p: string) => p === AGENT_HREF || p.startsWith(AGENT_HREF + "/"),
  },
]

function RailItem({
  entry,
  pathname,
  badge,
  flash,
}: {
  entry: RailEntry
  pathname: string
  badge?: number | null
  flash?: boolean
}) {
  const active = entry.isActive(pathname)
  const Icon = entry.icon
  return (
    <Link
      href={entry.href}
      aria-current={active ? "page" : undefined}
      title={entry.label}
      className={cn(
        "relative flex w-full flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <span className="relative">
        <Icon className={cn("h-[1.3rem] w-[1.3rem]", active ? "text-primary" : entry.iconClass)} />
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
      <span className="leading-none">{entry.label}</span>
    </Link>
  )
}

/**
 * 桌面端竖向图标轨 (md+) —— 取代横向 header。顶部 logo + 顶级区 (我的/资讯/社区/工具/AI),
 * 底部命令台触发器 + 主题 + 本机芯片 + 账户。移动端见 bottom-tab-bar。
 */
export default function Rail() {
  const pathname = usePathname()
  const { count, flash } = useHubCount()

  return (
    <aside className="hidden w-16 shrink-0 border-r bg-card md:block">
      <div className="sticky top-0 flex h-dvh flex-col items-center gap-1 px-2 py-3">
        <Link href="/" className="mb-2 flex items-center justify-center" aria-label="ideall 首页">
          <WonitaMark className="h-7 w-auto text-foreground" />
        </Link>
        <nav className="flex w-full flex-col items-center gap-1">
          {ENTRIES.map((e) => (
            <RailItem
              key={e.href}
              entry={e}
              pathname={pathname}
              badge={e.href === HUB_HREF ? count : undefined}
              flash={e.href === HUB_HREF ? flash : undefined}
            />
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-2 pt-2">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="命令台 (⌘K)"
            title="命令台 ⌘K"
            className="flex h-9 w-9 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Command className="h-[1.15rem] w-[1.15rem]" />
          </button>
          <ThemeToggle />
          <LocalDeviceChip compact />
          <AccountMenu />
        </div>
      </div>
    </aside>
  )
}
