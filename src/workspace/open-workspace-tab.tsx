"use client"

// 路由页标记: 不渲染 UI, 按当前路径 / query 打开目标或执行工作区命令。
// 所有 page.tsx 都 re-export 它, 使深链 / 刷新 / ⌘K / 侧栏 / 移动底栏统一分发。
// 标签内容由 WorkspaceShell → TabHost 渲染；Dock 命令则切换持久挂载的工作区工具。

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { parseResourceSearch } from "@protocol/resource"
import { parseFileEngineSearch } from "./file-tab"
import { descriptorForPath } from "./modules"
import {
  cancelRouteFileOpen,
  openRouteFileTarget,
  openTab,
  setDevelopmentTool,
  setRightPanel,
  setWorkspaceKind,
  useHydrated,
} from "./store"
import { defaultFileForPath } from "./file-roots"
import { workspaceCommandForPath } from "./workspace-route"
import { panelFileRef, resourceFileRef } from "@/filesystem/resource-file-system"

function OpenWorkspaceTabInner() {
  const pathname = usePathname()
  const search = useSearchParams()
  const hydrated = useHydrated()
  React.useEffect(() => {
    // 先完成工作区水合，再让显式深链覆盖恢复结果。首次启动目标由外壳仅在没有
    // 显式路由时发起，避免默认 Home 与当前路由并发 stat 造成竞态。
    if (!hydrated) return
    cancelRouteFileOpen()
    const run = () => {
      const p = pathname || "/"
      // /ai: AI 全局设置标签。常驻打开 (区别于下方其余路由统一用的 transient 预览)。
      if (p.startsWith("/ai")) {
        void openRouteFileTarget({
          type: "file",
          ref: panelFileRef("ai-settings"),
          rootId: "settings",
        })
        return
      }
      // /home/agent: AI 是右侧常驻对话栏, 不开标签 —— 呼出右栏即可。
      if (p.startsWith("/home/agent")) {
        setRightPanel(true)
        return
      }
      const workspaceCommand = workspaceCommandForPath(p)
      if (workspaceCommand) {
        setWorkspaceKind(workspaceCommand.workspace)
        if (workspaceCommand.developmentTool) {
          setDevelopmentTool(workspaceCommand.developmentTool)
        }
        return
      }
      // 路由驱动的打开 (移动底栏 / ⌘K / 深链 / 桌面 UrlSync 回写) 一律走「预览」(transient):
      // 在分区/底栏间穿梭只复用单一预览槽, 不再为每个落地路由静默堆一个常驻标签 (双击标签即固定)。
      // 命中已存在标签时 transient 分支不改其常驻性, 故已固定的标签不会被回写降级。
      //
      // 有 ?resource=node:* 或旧 ?node= → 只开节点标签并返回, 不再 fall through 到列表页 descriptor
      // (否则会把刚激活的节点标签 activeId 覆盖回列表页)。
      const rawSearch = search.toString()
      const fileTarget = parseFileEngineSearch(rawSearch)
      if (fileTarget && search.get("display") !== "window") {
        void openRouteFileTarget({ type: "file", ...fileTarget, transient: true }, "user")
        return
      }
      const resourceRef = parseResourceSearch(rawSearch)
      if (resourceRef) {
        void openRouteFileTarget(
          { type: "file", ref: resourceFileRef(resourceRef), transient: true },
          "user",
        )
        return
      }
      // 根路由不抢激活标签：外壳优先保留恢复现场；无快照时再打开用户配置的
      // 启动文件（缺省 Home）。
      if (p === "/" || p === "/home") return
      const defaultFile = defaultFileForPath(p)
      if (defaultFile) {
        void openRouteFileTarget({ type: "file", ...defaultFile, transient: true }, "user")
        return
      }
      const d = descriptorForPath(p)
      if (d) openTab(d, "user", { transient: true })
    }
    run()
    return cancelRouteFileOpen
  }, [hydrated, pathname, search])
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
