import Link from "next/link"
import { WonitaMark } from "@/components/shared/wonita-mark"
import ThemeToggle from "./theme-toggle"
import AccountMenu from "./account-menu"
import CommandTrigger from "@/components/shared/command-trigger"
import MobileNav from "./mobile-nav"

/**
 * 移动端顶栏 (md:hidden) —— 桌面端由左侧图标轨 (rail.tsx) 取代。
 * 移动端主导航走底部标签栏 (bottom-tab-bar.tsx); 此处提供全量菜单 / logo / 命令台触发器 / 主题 / 账户。
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:hidden">
      <MobileNav />
      <Link href="/" className="flex items-center" aria-label="ideall 首页">
        <WonitaMark className="h-6 w-auto text-foreground" />
      </Link>
      <CommandTrigger className="ml-1 h-8 flex-1" />
      <ThemeToggle />
      <AccountMenu />
    </header>
  )
}
