"use client"

// 移动端「浏览」抽屉 (汉堡, md:hidden) —— 文件树 + 发现/系统入口 + 主题/账户, 单一抽屉。
// 旧的独立文件树抽屉 (file-tree-sheet) 已并入: 双左侧抽屉入口易混, 顶栏也过挤。
// 文件树复用桌面二级侧栏 SidebarTree (随激活模块自动切换), 是「我的」各区段的层级入口
// (故不再平铺「我的」链接; 模块间跳转走底部标签栏)。主题/账户从顶栏移入抽屉底部 (顶栏瘦身)。
// 点击树节点改变 activeId → 自动收起 (展开/折叠不改 activeId, 不误关); 点链接亦收起。
import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Folder, Menu } from "lucide-react"
import { Button } from "@/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/ui/sheet"
import { WonitaMark } from "@/shared/wonita-mark"
import { cn } from "@/lib/utils"
import type { DirectoryEntry } from "@protocol/file-system"
import { HOME_SUBPAGES, SPOKES, type NavLink } from "@/shell/nav-config"
import FileSystemSidebarTree from "@/workspace/tree/file-system-sidebar-tree"
import {
  toggleFileRoot,
  toggleMountedFileRoot,
  useActiveId,
  useActiveRootId,
  useMode,
} from "@/workspace/store"
import { isCoreFileRootId, mountedFileRootId } from "@/workspace/file-roots"
import { useRootDirectoryEntries } from "@/workspace/use-root-directory-entries"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import ModeSwitch from "@/workspace/mode-switch"
import AccountMenu from "./account-menu"
import ThemeToggle from "./theme-toggle"

function isActive(pathname: string, href: string): boolean {
  if (href === "/home") return pathname === "/home"
  return pathname === href || pathname.startsWith(href + "/")
}

function rootIdForEntry(entry: DirectoryEntry): string {
  return isCoreFileRootId(entry.entryId) ? entry.entryId : mountedFileRootId(entry.target)
}

/** 单个导航链接 (模块级, 避免在 MobileNav 渲染体内重建组件类型 → 每次渲染都卸载重挂)。 */
function MLink({
  link,
  active,
  onNavigate,
}: {
  link: NavLink
  active: boolean
  onNavigate: () => void
}) {
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {link.dot ? (
        <span className={cn("h-2 w-2 rounded-full", link.dot)} />
      ) : (
        <link.icon className="h-4 w-4" />
      )}
      {link.label}
    </Link>
  )
}

/** 移动端浏览抽屉 (文件树 + 导航), 链接与桌面共用 nav-config 这一唯一数据来源。 */
export default function MobileNav() {
  const [open, setOpen] = React.useState(false)
  const pathname = usePathname()
  const activeId = useActiveId()
  const activeRootId = useActiveRootId()
  const mode = useMode()
  const rootEntries = useRootDirectoryEntries()
  const selectedRootId = rootEntries.some((entry) => rootIdForEntry(entry) === activeRootId)
    ? activeRootId
    : ""
  const lastActive = React.useRef(activeId)
  const lastMode = React.useRef(mode)
  const close = () => setOpen(false)

  // 打开期间激活标签变化 (= 用户在树里点开了节点/面板) → 收起抽屉, 露出主区内容。
  React.useEffect(() => {
    const modeChanged = mode !== lastMode.current
    if (open && activeId !== lastActive.current && !modeChanged) setOpen(false)
    lastActive.current = activeId
    lastMode.current = mode
  }, [activeId, mode, open])

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
        <SheetDescription className="sr-only">
          选择文件位置、浏览文件树或打开应用入口。
        </SheetDescription>
        <div className="shrink-0 border-b p-3">
          <ModeSwitch className="w-full" />
        </div>
        {rootEntries.length > 0 && (
          <div className="shrink-0 border-b p-3">
            <Select
              value={selectedRootId}
              onValueChange={(rootId) => {
                const entry = rootEntries.find((candidate) => rootIdForEntry(candidate) === rootId)
                if (!entry) return
                if (isCoreFileRootId(entry.entryId)) toggleFileRoot(entry.entryId)
                else toggleMountedFileRoot(entry.target)
              }}
            >
              <SelectTrigger className="h-9">
                <span className="flex min-w-0 items-center">
                  <Folder className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="选择文件位置" />
                </span>
              </SelectTrigger>
              <SelectContent>
                {rootEntries.map((entry) => {
                  return (
                    <SelectItem key={entry.entryId} value={rootIdForEntry(entry)}>
                      {entry.name}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
        )}
        {/* 文件树 (随激活模块自动切换): 层级浏览主体, 占满余高、内部滚动。 */}
        <div className="flex min-h-0 flex-1 flex-col">
          <FileSystemSidebarTree />
        </div>
        {/* 发现 / 系统入口 + 主题/账户 (从顶栏移入)。 */}
        <nav className="shrink-0 border-t px-2 py-2">
          <span className="block px-3 pb-1 text-xs font-medium text-muted-foreground">发现</span>
          {SPOKES.map((s) => (
            <MLink key={s.href} link={s} active={isActive(pathname, s.href)} onNavigate={close} />
          ))}
          <span className="block px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
            系统服务
          </span>
          {HOME_SUBPAGES.filter((p) => p.group === "system").map((p) => (
            <MLink key={p.href} link={p} active={isActive(pathname, p.href)} onNavigate={close} />
          ))}
          <div className="mt-2 flex items-center gap-1 border-t px-1 pt-2">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  )
}
