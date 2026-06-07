"use client"

import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { setThemeChoice } from "@/lib/theme"

/**
 * 深浅色切换。图标由 .dark 类纯 CSS 切换 (dark:block / dark:hidden),
 * 不用 React state —— 无 hydration 抖动, 也无 set-state-in-effect。
 */
export default function ThemeToggle() {
  function toggle() {
    const next = document.documentElement.classList.contains("dark") ? "light" : "dark"
    setThemeChoice(next)
  }

  return (
    <Button
      variant="outline"
      size="icon"
      className="shrink-0"
      aria-label="切换深浅色"
      title="切换深浅色"
      onClick={toggle}
    >
      <Sun className="hidden h-[1.15rem] w-[1.15rem] dark:block" />
      <Moon className="h-[1.15rem] w-[1.15rem] dark:hidden" />
      <span className="sr-only">切换深浅色</span>
    </Button>
  )
}
