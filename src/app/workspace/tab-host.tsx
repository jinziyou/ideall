"use client"

// 标签内容宿主: 全部已打开标签同时挂载, 非激活态 display:none (keep-alive)。
// 对 iframe 嵌入 (资讯/社区) 尤其关键: 切标签不重载、不重新握手 MCP。

import { cn } from "@/components/lib/utils"
import { useTabs, useActiveId } from "./store"
import { TabContent, tabLayout } from "./registry"

export default function TabHost() {
  const tabs = useTabs()
  const activeId = useActiveId()

  if (tabs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center text-muted-foreground">
        <p className="text-sm font-medium text-foreground">没有打开的标签</p>
        <p className="max-w-xs text-xs leading-relaxed">
          从左侧活动栏选择一个模块，再从侧栏打开一个面板。
        </p>
      </div>
    )
  }

  return (
    <div className="h-full w-full bg-background">
      {tabs.map((t) => {
        const active = t.id === activeId
        const fill = tabLayout(t.kind) === "fill"
        return (
          <div key={t.id} className={cn("h-full w-full", !active && "hidden")} aria-hidden={!active}>
            {fill ? (
              // 桌面: 组件自管理内部滚动 (h-full); 移动: 允许整体滚动兜底 (笔记等无视口高度约束)。
              <div className="h-full w-full overflow-y-auto md:overflow-hidden">
                <TabContent tab={t} />
              </div>
            ) : (
              <div className="h-full w-full overflow-y-auto">
                <div className="mx-auto w-full max-w-screen-2xl p-4 sm:p-6">
                  <TabContent tab={t} />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
