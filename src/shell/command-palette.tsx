"use client"

import * as React from "react"
import { CMDK_OPEN, openCommandPalette } from "@/lib/command-palette-bus"

const CommandPalettePanel = React.lazy(() => import("./command-palette-panel"))

// openCommandPalette / CMDK_OPEN 已抽到 @/lib/command-palette-bus (纯事件总线),
// 使 components 的触发器无需反向 import app/shell; 此处 re-export 维持既有 ./command-palette 导入点。
export { openCommandPalette }

/**
 * ⌘K 面板轻量宿主: 首次快捷键 / openCommandPalette() 之前不加载完整命令面板实现。
 * 完整面板挂载后自持后续开关事件与内容加载。
 */
export default function CommandPalette() {
  const [mounted, setMounted] = React.useState(false)
  const [initialOpen, setInitialOpen] = React.useState(false)

  React.useEffect(() => {
    if (mounted) return

    function mountOpen() {
      setInitialOpen(true)
      setMounted(true)
    }

    function onKey(e: KeyboardEvent) {
      if (e.key !== "k" || (!e.metaKey && !e.ctrlKey)) return
      e.preventDefault()
      mountOpen()
    }

    document.addEventListener("keydown", onKey)
    window.addEventListener(CMDK_OPEN, mountOpen)
    return () => {
      document.removeEventListener("keydown", onKey)
      window.removeEventListener(CMDK_OPEN, mountOpen)
    }
  }, [mounted])

  if (!mounted) return null

  return (
    <React.Suspense fallback={null}>
      <CommandPalettePanel initialOpen={initialOpen} />
    </React.Suspense>
  )
}
