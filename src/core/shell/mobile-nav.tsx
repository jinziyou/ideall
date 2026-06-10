"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { WonitaMark } from "@/components/wonita-mark"
import { cn } from "@/lib/utils"
import { HOME_SUBPAGES, SPOKES, type NavLink } from "@core/nav/nav-config"

function isActive(pathname: string, href: string): boolean {
  if (href === "/home") return pathname === "/home"
  return pathname === href || pathname.startsWith(href + "/")
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
        "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
        active
          ? "bg-pop/10 font-medium text-foreground"
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

/** 移动端导航 (Sheet), 与桌面共用 nav-config 单一真相源。 */
export default function MobileNav() {
  const [open, setOpen] = React.useState(false)
  const pathname = usePathname()
  const close = () => setOpen(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0 md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">打开菜单</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 max-w-[85vw] overflow-y-auto">
        <SheetTitle className="flex items-center gap-2">
          <WonitaMark className="h-5 w-auto text-foreground" />
          <span>wonita</span>
        </SheetTitle>
        <nav className="mt-6 flex flex-col gap-1">
          <span className="px-3 pb-1 text-xs font-medium text-muted-foreground">
            我的空间 · 中枢
          </span>
          {HOME_SUBPAGES.filter((p) => p.group !== "system").map((p) => (
            <MLink key={p.href} link={p} active={isActive(pathname, p.href)} onNavigate={close} />
          ))}
          <span className="px-3 pb-1 pt-4 text-xs font-medium text-muted-foreground">
            系统能力
          </span>
          {HOME_SUBPAGES.filter((p) => p.group === "system").map((p) => (
            <MLink key={p.href} link={p} active={isActive(pathname, p.href)} onNavigate={close} />
          ))}
          <span className="px-3 pb-1 pt-4 text-xs font-medium text-muted-foreground">发现</span>
          {SPOKES.map((s) => (
            <MLink key={s.href} link={s} active={isActive(pathname, s.href)} onNavigate={close} />
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
