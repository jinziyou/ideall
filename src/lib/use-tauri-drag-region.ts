"use client"

// Tauri 无边框窗拖拽区: 仅客户端挂载后启用, 避免 SSR/水合与客户端 DOM 不一致。
import * as React from "react"
import { isTauri } from "@/lib/tauri"

export function useTauriDragRegion(): boolean {
  const [enabled, setEnabled] = React.useState(false)
  React.useEffect(() => {
    setEnabled(isTauri())
  }, [])
  return enabled
}
