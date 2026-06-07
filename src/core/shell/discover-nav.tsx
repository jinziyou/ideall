"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Map, Newspaper, Wrench } from "lucide-react"

const sections = [
  { href: "/info", label: "资讯", icon: Newspaper },
  { href: "/community", label: "社区", icon: Map },
  { href: "/tool", label: "工具", icon: Wrench },
]

/**
 * 「发现」分区导航: 资讯 / 社区 / 工具 三个聚合模块的入口。
 * 路由保持各自原样 (/info、/community、/tool), 仅在视觉上归到「发现」之下。
 */
export default function DiscoverNav() {
  const pathname = usePathname()

  return (
    <nav className="inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
      {sections.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={href}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-background text-foreground shadow-sm" : "hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
