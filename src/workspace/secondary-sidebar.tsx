"use client"

// 二级侧栏：显示当前五分区的固定叶项。

import { PanelLeftClose } from "lucide-react"
import { cn } from "@/lib/utils"
import { IDEALL_ROOT_REF } from "@/filesystem/root-ref"
import NavigationSidebarList from "./navigation-sidebar-list"
import { navigationSection, navigationSectionForEntry } from "./navigation-sections"
import { useActiveRootId, setSidebarCollapsed } from "./store"
import { useNavigationDirectory } from "./use-navigation-directory"

export default function SecondarySidebar({ collapsed = false }: { collapsed?: boolean }) {
  const activeRootId = useActiveRootId()
  const navigation = useNavigationDirectory(IDEALL_ROOT_REF)
  const loadedSection = navigation.items
    .map(({ entry }) => navigationSectionForEntry(entry))
    .find((section) => section?.id === activeRootId)
  const title = loadedSection?.label ?? navigationSection(activeRootId).label

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
        <NavigationSidebarList />
      </div>
    </aside>
  )
}
