"use client"

import { toast } from "sonner"
import { setSettingsThemeChoice } from "@/modules/home/settings/settings-write-adapter"
import { ThemeToggleButton } from "@/shared/theme-toggle-button"

/**
 * 深浅色切换。图标由 .dark 类纯 CSS 切换 (dark:block / dark:hidden),
 * 不用 React state —— 无 hydration 抖动, 也无 set-state-in-effect。
 */
export default function ThemeToggle() {
  return (
    <ThemeToggleButton
      onToggle={() => {
        const next = document.documentElement.classList.contains("dark") ? "light" : "dark"
        void setSettingsThemeChoice(next).catch(() => toast.error("主题切换失败"))
      }}
    />
  )
}
