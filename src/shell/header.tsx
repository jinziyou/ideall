import Link from "next/link"
import { WonitaMark } from "@/shared/wonita-mark"
import CommandTrigger from "@/shared/command-trigger"
import MobileNav from "./mobile-nav"
import WindowControls from "./window-controls"

/**
 * 移动端顶栏 (md:hidden) —— 桌面端由左侧图标轨取代。已瘦身为 3+1 项:
 * 浏览抽屉 (汉堡 = 文件树 + 发现/系统 + 主题/账户, 见 mobile-nav) / logo / 搜索 (⌘K 统一面板)
 * + (Tauri 窄窗) 窗控。多标签切换器已移入底栏最右 (拇指区, 见 bottom-tab-bar);
 * 移动端主导航走底部标签栏 (bottom-tab-bar.tsx)。
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
      </div>
      {/* Tauri 窄窗才显示 (非 Tauri 返回 null), 保证收窄时仍能最小化/关闭窗口。 */}
      <WindowControls />
    </header>
  )
}
