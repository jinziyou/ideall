"use client"

// 二级侧栏: 标题栏 + 统一文件树 (所有模式共用 sidebar-tree)。
// 点击树节点 → 开/激活标签; 概览由活动栏「我的」直达。

import { PanelLeftClose } from "lucide-react"
import { cn } from "@/lib/utils"
import FileSystemSidebarTree from "./tree/file-system-sidebar-tree"
import { coreFileRoot, isCoreFileRootId } from "./file-roots"
import { useActiveRootId, setSidebarCollapsed } from "./store"

export default function SecondarySidebar({ collapsed = false }: { collapsed?: boolean }) {
  const activeRootId = useActiveRootId()
  const title = isCoreFileRootId(activeRootId)
    ? coreFileRoot(activeRootId).sidebarTitle
    : "已挂载文件"

  return (
    <aside
      // 折叠用 w-0/opacity-0 (非 display:none) 以保过渡动画 → 子树仍在 Tab 顺序里;
      // inert 一并禁用可聚焦性并解决 aria-hidden 内含可聚焦元素的冲突 (WCAG 4.1.2)。
      inert={collapsed}
      aria-hidden={collapsed}
      className={cn(
        "hidden h-full shrink-0 overflow-hidden bg-card transition-[width,opacity] duration-200 md:flex",
        collapsed ? "w-0 opacity-0" : "w-60 border-r opacity-100",
      )}
    >
      <div className="flex h-full w-60 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setSidebarCollapsed(true)}
            title="收起侧栏"
            aria-label="收起侧栏"
            className="flex h-6 w-6 items-center justify-center rounded-shell text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
        <FileSystemSidebarTree />
      </div>
    </aside>
  )
}
