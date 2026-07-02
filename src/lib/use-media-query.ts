"use client"

// 响应式媒体查询 hook (useSyncExternalStore): SSR/预渲染期返回 false, 水合后按真实视口重渲染。
// 仅用于「必须在 JS 里分叉行为」的场景 (如移动全屏覆盖层的 dialog 语义 / inert); 纯样式分叉请用 Tailwind 断点。
import * as React from "react"

export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", cb)
      return () => mql.removeEventListener("change", cb)
    },
    [query],
  )
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}
