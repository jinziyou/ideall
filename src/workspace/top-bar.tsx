"use client"

// 桌面顶边栏 (现代面板式标签工作区, Tauri 下兼作标题栏): 左 = logo + 本地/连接模式切换;
// 中 = 统一搜索框; 右 = 拖拽区 + 布局开关 (侧栏 / AI 侧栏) + 设置 + 账户 + (Tauri) 窗控。
// Tauri: 仅空白区标记 data-tauri-drag-region —— 勿挂在 header 上, 否则 Linux/WSL 下子按钮可能收不到点击。
import Link from "next/link"
import { WonitaMark } from "@/shared/wonita-mark"
import AccountMenu from "@/shell/account-menu"
import WindowControls from "@/shell/window-controls"
import ModeSwitch from "./mode-switch"
import SettingsMenu from "./settings-menu"
import TopSearch from "./top-search"
import LayoutToggles from "./layout-toggles"
import { useTauriDragRegion } from "@/lib/use-tauri-drag-region"

export default function TopBar() {
  const dragRegion = useTauriDragRegion()

  return (
    <header className="relative z-30 hidden h-11 shrink-0 items-center gap-2 border-b bg-card px-3 md:flex">
      <div className="flex shrink-0 items-center gap-2">
        <Link href="/home" className="flex shrink-0 items-center" aria-label="ideall 首页">
          <WonitaMark className="h-6 w-auto text-foreground" />
        </Link>
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />
        <ModeSwitch />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
        <div
          {...(dragRegion ? { "data-tauri-drag-region": true } : {})}
          className="min-w-4 flex-1"
          aria-hidden
        />
        <TopSearch />
        <div
          {...(dragRegion ? { "data-tauri-drag-region": true } : {})}
          className="min-w-4 flex-1"
          aria-hidden
        />
      </div>
      <div
        className="relative z-50 flex shrink-0 items-stretch gap-1 self-stretch pointer-events-auto"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-1">
          <LayoutToggles />
          <div className="mx-1 h-5 w-px bg-border" />
          <SettingsMenu />
          <AccountMenu />
        </div>
        <WindowControls />
      </div>
    </header>
  )
}
