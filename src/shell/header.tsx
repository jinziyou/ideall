import Link from "next/link"
import { WonitaMark } from "@/shared/wonita-mark"
import ThemeToggle from "./theme-toggle"
import AccountMenu from "./account-menu"
import CommandTrigger from "@/shared/command-trigger"
import MobileNav from "./mobile-nav"
import FileTreeSheet from "./file-tree-sheet"
import TabsSheet from "./tabs-sheet"

/**
 * 移动端顶栏 (md:hidden) —— 桌面端由左侧图标轨 (rail.tsx) 取代。
 * 移动端主导航走底部标签栏 (bottom-tab-bar.tsx); 此处提供全量菜单 / logo / 命令台触发器 / 文件树 / 标签 / 主题 / 账户。
 * 文件树 (FileTreeSheet) 与标签 (TabsSheet) 补齐移动端此前缺失的层级浏览与多标签切换/关闭入口。
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:hidden">
      <MobileNav />
      <Link href="/" className="flex items-center" aria-label="ideall 首页">
        <WonitaMark className="h-6 w-auto text-foreground" />
      </Link>
      <CommandTrigger className="ml-1 h-8 min-w-0 flex-1" />
      <FileTreeSheet />
      <TabsSheet />
      <ThemeToggle />
      <AccountMenu />
    </header>
  )
}
