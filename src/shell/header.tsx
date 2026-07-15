"use client"

import { WonitaMark } from "@/shared/wonita-mark"
import CommandTrigger from "@/shared/command-trigger"
import { HOME_TARGET } from "@/shell/nav-config"
import { openTarget } from "@/workspace/store"
import MobileNav from "./mobile-nav"
import WindowControls from "./window-controls"
import { useTauriDragRegion } from "@/lib/use-tauri-drag-region"

/**
 * 移动端顶栏 (md:hidden) —— 桌面端由左侧图标轨取代。已瘦身为 3+1 项:
 * 浏览抽屉 (汉堡 = 文件树 + 发现/系统 + 主题/账户, 见 mobile-nav) / logo / 搜索 (⌘K 统一面板)
 * + (Tauri 窄窗) 窗控。多标签切换器已移入底栏最右 (拇指区, 见 bottom-tab-bar);
 * 移动端主导航走底部标签栏 (bottom-tab-bar.tsx)。
 * data-tauri-drag-region + WindowControls: 当 Tauri 窗口被收窄到 <md (此时本栏取代顶边栏) 仍保有窗口拖拽与窗控。
 */
export function Header() {
  const dragRegion = useTauriDragRegion()

  return (
    <header className="sticky top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] min-w-0 items-stretch gap-2 overflow-hidden border-b bg-background/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <MobileNav />
      <button
        type="button"
        onClick={() => openTarget(HOME_TARGET)}
        className="flex shrink-0 items-center"
        aria-label="ideall 首页"
      >
        <WonitaMark className="h-6 w-auto text-foreground" />
      </button>
      <CommandTrigger className="ml-1 h-8 min-w-0 max-w-[14rem] flex-1" />
      {/* 仅空白条带可拖拽; 勿挂整栏, 否则 WebView2 会吞子控件 mousedown。 */}
      <div
        {...(dragRegion ? { "data-tauri-drag-region": true } : {})}
        className="min-w-0 flex-1"
        aria-hidden
      />
      <WindowControls />
    </header>
  )
}
