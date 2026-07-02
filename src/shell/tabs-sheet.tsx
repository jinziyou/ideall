"use client"

// 移动端「标签」抽屉 (md:hidden): 列出所有已打开标签, 点击切换 / X 关闭。
// 移动端底栏是「模块」导航 (非已开标签), 多标签切换/关闭走这里。
// 触发按钮带标签数角标 (类浏览器标签数), 底部抽屉 (拇指区) 复用桌面标签条的色点/类型徽标。
// variant="bar": 底栏样式触发器 (图标+「标签」字样, 挂底部标签栏最右); 缺省 = 独立图标钮。

import * as React from "react"
import { Layers, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/ui/sheet"
import { useTabs, useActiveId, setActiveTab, closeTab } from "@/workspace/store"
import { tabViewType, TAB_VIEW_LABEL } from "@/workspace/tab-view-type"
import { MODULE_DOT } from "@/workspace/module-dot"

export default function TabsSheet({ variant = "icon" }: { variant?: "icon" | "bar" }) {
  const [open, setOpen] = React.useState(false)
  const tabs = useTabs()
  const activeId = useActiveId()

  const countBadge =
    tabs.length > 0 ? (
      <span className="absolute -right-1 -top-1 inline-grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold tabular-nums text-primary-foreground">
        {tabs.length > 99 ? "99+" : tabs.length}
      </span>
    ) : null

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {variant === "bar" ? (
          <button
            type="button"
            className="flex flex-1 flex-col items-center gap-0.5 rounded-shell py-1 text-[10px] font-medium text-muted-foreground"
          >
            <span className="relative">
              <Layers className="h-[1.3rem] w-[1.3rem]" />
              {countBadge}
            </span>
            <span className="leading-none">标签</span>
          </button>
        ) : (
          <Button variant="outline" size="icon" className="relative h-8 w-8 shrink-0 md:hidden">
            <Layers className="h-4 w-4" />
            {countBadge}
            <span className="sr-only">标签列表</span>
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[70vh] gap-0 p-0 pt-2">
        <SheetTitle className="px-4 pb-2 text-sm">标签 · {tabs.length}</SheetTitle>
        <div className="px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
          {tabs.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-muted-foreground">还没有打开的标签</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {tabs.map((t) => (
                <li key={t.id}>
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-shell px-2 py-2",
                      t.id === activeId ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab(t.id)
                        setOpen(false)
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                    >
                      <span
                        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", MODULE_DOT[t.module])}
                      />
                      <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground">
                        {TAB_VIEW_LABEL[tabViewType(t)]}
                      </span>
                      <span className="flex-1 truncate text-sm text-foreground">{t.title}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`关闭 ${t.title}`}
                      onClick={() => closeTab(t.id)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-shell text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-muted/80"
                    >
                      <X className="h-4 w-4" strokeWidth={2.25} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
