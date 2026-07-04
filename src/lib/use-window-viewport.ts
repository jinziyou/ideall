"use client"

// Tauri/GTK 手工改窗尺寸后 innerHeight / dvh 可能不刷新 —— 同步 CSS 变量并监听 resize。
import * as React from "react"
import { isTauri } from "@/lib/tauri"

function syncViewportVars() {
  const root = document.documentElement
  root.style.setProperty("--app-h", `${window.innerHeight}px`)
  root.style.setProperty("--app-w", `${window.innerWidth}px`)
}

/** 挂载后同步视口尺寸; Tauri 额外订阅 onResized (WSL 伪最大化常只触发此事件)。 */
export function useWindowViewport(): void {
  React.useEffect(() => {
    syncViewportVars()
    window.addEventListener("resize", syncViewportVars)
    let unlisten: (() => void) | undefined
    let alive = true
    if (isTauri()) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().onResized(syncViewportVars))
        .then((fn) => {
          if (!alive) fn()
          else unlisten = fn
        })
        .catch(() => {})
    }
    return () => {
      alive = false
      window.removeEventListener("resize", syncViewportVars)
      unlisten?.()
    }
  }, [])
}
