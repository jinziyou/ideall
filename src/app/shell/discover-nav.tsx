"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/components/lib/utils"
import { SPOKES } from "@/app/nav/nav-config"

/**
 * 「发现」分区导航: 资讯 / 社区 / 工具 三个聚合模块的入口 (分段控件)。
 * 路由保持各自原样 (/info、/community、/tool), 仅在视觉上归到「发现」之下。
 * 列表复用 nav-config 的 SPOKES 单一真相源 (与图标轨 / 移动菜单 / 命令台同源)。
 */
export default function DiscoverNav() {
  const pathname = usePathname()

  return (
    <nav className="inline-flex w-fit items-center gap-1 rounded-xl border bg-card p-1 shadow-sm">
      {SPOKES.map(({ href, label, icon: Icon, dot }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className={cn("h-4 w-4", !active && dot?.replace("bg-", "text-"))} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
