"use client"

// 二级侧栏 (IDE 资源管理器式): 标题栏(模块名 + 收起) + 模块条目列表。
// 条目是 <Link href=path> → 路由标记打开/激活标签 (与深链 / ⌘K 统一)。

import Link from "next/link"
import { PanelLeftClose } from "lucide-react"
import { cn } from "@/lib/utils"
import SidebarWebSearch from "./sidebar-web-search"
import PlacesSidebar from "./places-sidebar"
import { moduleById } from "./modules"
import { tabKey, useActiveModule, useActiveId, useMode, setSidebarCollapsed } from "./store"

export default function SecondarySidebar({ collapsed = false }: { collapsed?: boolean }) {
  const activeModule = useActiveModule()
  const activeId = useActiveId()
  const mode = useMode()
  const mod = moduleById(activeModule)

  return (
    // 折叠用 width/opacity 过渡 (始终挂载, 避免布局抖动); 内层固定 w-60 防折叠动画时重排。
    <aside
      aria-hidden={collapsed}
      className={cn(
        "hidden h-full shrink-0 overflow-hidden bg-card transition-[width,opacity] duration-200 md:flex",
        collapsed ? "w-0 opacity-0" : "w-60 border-r opacity-100",
      )}
    >
      <div className="flex h-full w-60 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
          <h2 className="text-sm font-semibold text-foreground">{mod.sidebarTitle}</h2>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(true)}
            title="收起侧栏"
            aria-label="收起侧栏"
            className="flex h-6 w-6 items-center justify-center rounded-shell text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        {/* 「我的」: 一切皆文件 —— places 切换 + 跨 kind 文件树; 其余模块: 既有条目列表。 */}
        {activeModule === "home" ? (
          <PlacesSidebar />
        ) : (
          <div className="flex-1 overflow-y-auto p-2">
            {/* 聚合搜索引擎 (工具), 仅连接模式展示 (联网) */}
            {mode === "connected" && <SidebarWebSearch />}
            {mod.sidebarHint && (
              <p className="px-2 pb-2 pt-1 text-xs leading-relaxed text-muted-foreground">
                {mod.sidebarHint}
              </p>
            )}
            <nav className="flex flex-col gap-0.5">
              {mod.entries.map((e) => {
                const Icon = e.icon
                const id = tabKey(e.descriptor)
                const active = activeId === id
                return (
                  <Link
                    key={id}
                    href={e.descriptor.path || "#"}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-shell px-2.5 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate text-left">{e.label}</span>
                  </Link>
                )
              })}
            </nav>
          </div>
        )}
      </div>
    </aside>
  )
}
