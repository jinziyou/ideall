"use client"

// 路由页标记: 不渲染 UI, 仅按当前路径 / ?resource= 或旧 ?node= 打开/激活对应工作区标签。
// 所有 page.tsx 都 re-export 它, 使深链 / 刷新 / ⌘K / 侧栏 / 移动底栏 统一驱动标签。
// 实际内容由根布局里持久挂载的 WorkspaceShell → TabHost 渲染 (keep-alive)。

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { descriptorForNode, descriptorForPath } from "./modules"
import { openTab, setRightPanel, openAiSettings } from "./store"

function OpenWorkspaceTabInner() {
  const pathname = usePathname()
  const search = useSearchParams()
  React.useEffect(() => {
    const p = pathname || "/"
    // /ai: AI 全局设置标签。常驻打开 (区别于下方其余路由统一用的 transient 预览)。
    if (p.startsWith("/ai")) {
      openAiSettings()
      return
    }
    // /home/agent: AI 是右侧常驻对话栏, 不开标签 —— 呼出右栏即可。
    if (p.startsWith("/home/agent")) {
      setRightPanel(true)
      return
    }
    // 路由驱动的打开 (移动底栏 / ⌘K / 深链 / 桌面 UrlSync 回写) 一律走「预览」(transient):
    // 在分区/底栏间穿梭只复用单一预览槽, 不再为每个落地路由静默堆一个常驻标签 (双击标签即固定)。
    // 命中已存在标签时 transient 分支不改其常驻性, 故已固定的标签不会被回写降级。
    //
    // 有 ?resource=node:* 或旧 ?node= → 只开节点标签并返回, 不再 fall through 到列表页 descriptor
    // (否则会把刚激活的节点标签 activeId 覆盖回列表页)。
    const nodeD = descriptorForNode(search.toString())
    if (nodeD) {
      openTab(nodeD, "user", { transient: true })
      return
    }
    const d = descriptorForPath(p)
    if (d) openTab(d, "user", { transient: true })
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
