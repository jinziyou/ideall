"use client"

// 桌面顶边栏 (Trae 风格): 左 = logo + 模式切换; 中 = 本地搜索; 右 = 布局开关 + 设置 + 账户。
import Link from "next/link"
import { WonitaMark } from "@/components/shared/wonita-mark"
import AccountMenu from "@/app/shell/account-menu"
import ModeSwitch from "./mode-switch"
import SettingsMenu from "./settings-menu"
import TopSearch from "./top-search"
import LayoutToggles from "./layout-toggles"

export default function TopBar() {
  return (
    <header className="hidden h-11 shrink-0 items-center gap-2 border-b bg-card px-3 md:flex">
      <Link href="/home" className="flex shrink-0 items-center" aria-label="ideall 首页">
        <WonitaMark className="h-6 w-auto text-foreground" />
      </Link>
      <div className="mx-1 h-5 w-px shrink-0 bg-border" />
      <ModeSwitch />
      <div className="flex flex-1 justify-center px-4">
        <TopSearch />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <LayoutToggles />
        <div className="mx-1 h-5 w-px bg-border" />
        <SettingsMenu />
        <AccountMenu />
      </div>
    </header>
  )
}
