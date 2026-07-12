"use client"

// 移动端导航抽屉与桌面共用五分区及其叶项。
import * as React from "react"
import { Menu } from "lucide-react"
import { Button } from "@/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/ui/sheet"
import { WonitaMark } from "@/shared/wonita-mark"
import NavigationSidebarList from "@/workspace/navigation-sidebar-list"
import {
  NAVIGATION_SECTIONS,
  isNavigationSectionId,
  navigationSection,
} from "@/workspace/navigation-sections"
import { toggleFileRoot, useActiveId, useActiveRootId } from "@/workspace/store"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import AccountMenu from "./account-menu"
import ThemeToggle from "./theme-toggle"

/** 移动端浏览抽屉。 */
export default function MobileNav() {
  const [open, setOpen] = React.useState(false)
  const activeId = useActiveId()
  const activeRootId = useActiveRootId()
  const section = navigationSection(activeRootId)
  const SectionIcon = section.icon
  const lastActive = React.useRef(activeId)
  const close = () => setOpen(false)

  // 打开期间激活标签变化 → 收起抽屉，露出主区内容。
  React.useEffect(() => {
    if (open && activeId !== lastActive.current) setOpen(false)
    lastActive.current = activeId
  }, [activeId, open])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0 md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">打开浏览抽屉</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-80 max-w-[88vw] flex-col gap-0 p-0">
        <SheetTitle className="flex shrink-0 items-center gap-2 border-b px-4 py-3 text-sm">
          <WonitaMark className="h-5 w-auto text-foreground" />
          <span>ideall</span>
        </SheetTitle>
        <SheetDescription className="sr-only">选择导航分区并打开其中的功能。</SheetDescription>
        <div className="shrink-0 border-b p-3">
          <Select
            value={section.id}
            onValueChange={(rootId) => {
              if (isNavigationSectionId(rootId)) toggleFileRoot(rootId)
            }}
          >
            <SelectTrigger className="h-9">
              <span className="flex min-w-0 items-center">
                <SectionIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="选择导航分区" />
              </span>
            </SelectTrigger>
            <SelectContent>
              {NAVIGATION_SECTIONS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <NavigationSidebarList sectionId={section.id} onNavigate={close} />
        </div>
        <div className="shrink-0 border-t px-3 py-2">
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
