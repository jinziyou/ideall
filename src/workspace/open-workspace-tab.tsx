"use client"

// 路由页标记: 不渲染 UI, 仅按当前路径 / ?node= 打开/激活对应工作区标签。
// 所有 page.tsx 都 re-export 它, 使深链 / 刷新 / ⌘K / 侧栏 / 移动底栏 统一驱动标签。
// 实际内容由根布局里持久挂载的 WorkspaceShell → TabHost 渲染 (keep-alive)。

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { descriptorForNode, descriptorForPath } from "./modules"
import { openTab, setRightPanel } from "./store"

function OpenWorkspaceTabInner() {
  const pathname = usePathname()
  const search = useSearchParams()
  React.useEffect(() => {
    const p = pathname || "/"
    // /home/agent: AI 是右侧常驻对话栏, 不开标签 —— 呼出右栏即可。
    if (p.startsWith("/home/agent")) {
      setRightPanel(true)
      return
    }
    // 有 ?node= → 只开节点标签并返回, 不再 fall through 到列表页 descriptor
    // (否则会把刚激活的节点标签 activeId 覆盖回列表页)。
    const nodeD = descriptorForNode(search.toString())
    if (nodeD) {
      openTab(nodeD)
      return
    }
    const d = descriptorForPath(p)
    if (d) openTab(d)
  }, [pathname, search])
  return null
}

export default function OpenWorkspaceTab() {
  // useSearchParams 在 output:export 下必须包 <Suspense> (编译期硬约束)。
  return (
    <React.Suspense fallback={null}>
      <OpenWorkspaceTabInner />
    </React.Suspense>
  )
}
