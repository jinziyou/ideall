import Link from "next/link"
import { WonitaMark } from "@/components/shared/wonita-mark"
import ThemeToggle from "./theme-toggle"
import AccountMenu from "./account-menu"
import CommandPalette from "./command-palette"
import LocalDeviceChip from "./local-device-chip"
import HubNavLink from "./hub-nav-link"
import MobileNav from "./mobile-nav"
import { SPOKES } from "@/app/nav/nav-config"

/**
 * 全局头部 —— 中枢获视觉首位, 三条 spoke 显式从属。
 * 由 nav-config 单一真相源驱动 (桌面 + 移动)。已弃用 Radix NavigationMenu
 * (其在 React 19 下的既有 hydration 告警随之消除)。
 */
export function Header() {
  return (
    <header className="sticky top-0 z-50 flex h-16 items-center gap-3 border-b bg-background px-4 md:px-6">
      <MobileNav />

      <Link href="/" className="flex items-center gap-2">
        <WonitaMark className="h-7 w-auto text-foreground" />
        <span className="hidden font-semibold tracking-tight sm:inline">ideall</span>
      </Link>

      {/* 桌面导航: 我的 (主) + 发现三 spoke (次级) */}
      <nav className="hidden items-center gap-1 md:flex">
        <HubNavLink />
        <span className="ml-2 mr-1 whitespace-nowrap text-xs text-muted-foreground">发现</span>
        {SPOKES.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <span className={`h-2 w-2 rounded-full ${s.dot}`} />
            {s.label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <CommandPalette />
        <ThemeToggle />
        <div className="hidden md:block">
          <LocalDeviceChip />
        </div>
        <AccountMenu />
      </div>
    </header>
  )
}
