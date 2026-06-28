"use client"

// 移动端「文件树」抽屉 (md:hidden): 复用桌面二级侧栏的 SidebarTree (纯 hook 驱动, 随激活模块
// 自动切换), 让「一切皆文件」的层级浏览在移动端也可用 (此前移动端无任何文件树入口)。
// 点击节点会改变 activeId → 自动收起抽屉, 露出主区内容 (展开/折叠不改 activeId, 故不会误关)。

import * as React from "react"
import { ListTree } from "lucide-react"
import { Button } from "@/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/ui/sheet"
import SidebarTree from "@/workspace/sidebar-tree"
import { useActiveId } from "@/workspace/store"

export default function FileTreeSheet() {
  const [open, setOpen] = React.useState(false)
  const activeId = useActiveId()
  const lastActive = React.useRef(activeId)

  // 打开期间激活标签变化 (= 用户点了某个节点/面板) → 收起抽屉; 展开/折叠不改 activeId, 不触发。
  React.useEffect(() => {
    if (open && activeId !== lastActive.current) setOpen(false)
    lastActive.current = activeId
  }, [activeId, open])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0 md:hidden">
          <ListTree className="h-4 w-4" />
          <span className="sr-only">文件树</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-72 max-w-[85vw] flex-col gap-0 p-0">
        <SheetTitle className="shrink-0 border-b px-3 py-3 text-sm">文件树</SheetTitle>
        <div className="flex min-h-0 flex-1 flex-col">
          <SidebarTree />
        </div>
      </SheetContent>
    </Sheet>
  )
}
