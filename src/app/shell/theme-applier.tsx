"use client"

import * as React from "react"
import { applyTheme, getThemeChoice } from "@/components/lib/theme"

/**
 * 水合后重新断言主题 class。
 * 内联脚本 (THEME_INIT) 在首帧前已设好 .dark, 但若根树因其它组件的 hydration 不一致被 React
 * 重新渲染, <html> 的 class 可能被抹掉 —— 这里在 effect 里再 applyTheme 一次兜底,
 * 并在 system 模式下跟随系统深浅色变化。只操作 DOM, 不调 setState。
 */
export default function ThemeApplier() {
  React.useEffect(() => {
    applyTheme(getThemeChoice())
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      if (getThemeChoice() === "system") applyTheme("system")
    }
    mq.addEventListener?.("change", onChange)
    return () => mq.removeEventListener?.("change", onChange)
  }, [])

  return null
}
