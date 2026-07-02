"use client"

// 桌面顶边栏 (现代面板式标签工作区, Tauri 下兼作标题栏): 左 = logo + 本地/连接模式切换;
// 中 = 统一搜索框 (唤起 ⌘K 面板, 本地搜索+命令单一入口); 右 = 布局开关 + 设置 + 账户 + (Tauri) 窗控。
// data-tauri-drag-region 让空白处可拖动窗口 (交互子元素不触发拖动); 窗控并入此栏后删去了独立的满宽标题栏。
import Link from "next/link"
import { WonitaMark } from "@/shared/wonita-mark"
import AccountMenu from "@/shell/account-menu"
import WindowControls from "@/shell/window-controls"
import ModeSwitch from "./mode-switch"
import SettingsMenu from "./settings-menu"
import TopSearch from "./top-search"
import LayoutToggles from "./layout-toggles"

export default function TopBar() {
  return (
    <header
      data-tauri-drag-region
      className="hidden h-11 shrink-0 items-center gap-2 border-b bg-card px-3 md:flex"
    >
      <Link href="/home" className="flex shrink-0 items-center" aria-label="ideall 首页">
        <WonitaMark className="h-6 w-auto text-foreground" />
      </Link>
      <div className="mx-1 h-5 w-px shrink-0 bg-border" />
      <ModeSwitch />
      <div data-tauri-drag-region className="flex flex-1 justify-center px-4">
        <TopSearch />
      </div>
      {/* self-stretch: 撑满 header 全高 (44px), 使窗控贴到右上角 (甩到角落即可关闭) 而非缩成内容高。 */}
      <div className="flex shrink-0 items-stretch gap-1 self-stretch">
        <div className="flex items-center gap-1">
          {/* ⌘K 可见入口即中部搜索框 (单一入口); 此处不再放重复的命令面板图标钮。 */}
          <LayoutToggles />
          <div className="mx-1 h-5 w-px bg-border" />
          <SettingsMenu />
          <AccountMenu />
        </div>
        {/* Tauri 无边框窗口: 窗控并入本栏最右 (非 Tauri 返回 null)。 */}
        <WindowControls />
      </div>
    </header>
  )
}
