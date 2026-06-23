"use client"

// 路由页标记: 不渲染 UI, 仅按当前路径打开/激活对应工作区标签。
// 所有 page.tsx 都 re-export 它, 使深链 / 刷新 / ⌘K / 侧栏 / 移动底栏 统一驱动标签。
// 实际内容由根布局里持久挂载的 WorkspaceShell → TabHost 渲染 (keep-alive)。

import * as React from "react"
import { usePathname } from "next/navigation"
import { descriptorForPath } from "./modules"
import { openTab, setRightPanel } from "./store"

export default function OpenWorkspaceTab() {
  const pathname = usePathname()
  React.useEffect(() => {
    const p = pathname || "/"
    // /home/agent: AI 是右侧常驻对话栏, 不开标签 —— 呼出右栏即可。
    if (p.startsWith("/home/agent")) {
      setRightPanel(true)
      return
    }
    const d = descriptorForPath(p)
    if (d) openTab(d)
  }, [pathname])
  return null
}
