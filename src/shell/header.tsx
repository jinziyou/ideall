import Link from "next/link"
import { WonitaMark } from "@/shared/wonita-mark"
import ThemeToggle from "./theme-toggle"
import AccountMenu from "./account-menu"
import CommandTrigger from "@/shared/command-trigger"
import MobileNav from "./mobile-nav"
import FileTreeSheet from "./file-tree-sheet"
import TabsSheet from "./tabs-sheet"
import WindowControls from "./window-controls"

/**
 * 移动端顶栏 (md:hidden) —— 桌面端由左侧图标轨 (rail.tsx) 取代。
 * 移动端主导航走底部标签栏 (bottom-tab-bar.tsx); 此处提供全量菜单 / logo / 命令台触发器 / 文件树 / 标签 / 主题 / 账户。
 * 文件树 (FileTreeSheet) 与标签 (TabsSheet) 补齐移动端此前缺失的层级浏览与多标签切换/关闭入口。
 * data-tauri-drag-region + WindowControls: 当 Tauri 窗口被收窄到 <md (此时本栏取代顶边栏) 仍保有窗口拖拽与窗控。
 */
export function Header() {
  return (
    <header
      data-tauri-drag-region
      className="sticky top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-stretch gap-2 border-b bg-background/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MobileNav />
        <Link href="/" className="flex items-center" aria-label="ideall 首页">
          <WonitaMark className="h-6 w-auto text-foreground" />
        </Link>
        <CommandTrigger className="ml-1 h-8 min-w-0 flex-1" />
        <FileTreeSheet />
        <TabsSheet />
        <ThemeToggle />
        <AccountMenu />
      </div>
      {/* Tauri 窄窗才显示 (非 Tauri 返回 null), 保证收窄时仍能最小化/关闭窗口。 */}
      <WindowControls />
    </header>
  )
}
