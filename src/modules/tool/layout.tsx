"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bot, Compass, Search } from "lucide-react"

import { AppHeader } from "@/shared/app-header"

const tabs = [
  { href: "/tool/search", label: "搜索", icon: Search },
  { href: "/tool/ai", label: "AI", icon: Bot },
  { href: "/tool/navigation", label: "导航", icon: Compass },
]

export default function ToolLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <main className="m-2 flex flex-col gap-4 sm:m-4">
      <AppHeader title="工具" dotClass="bg-spoke-tool" />
      <nav className="flex items-center gap-4 border-b">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={
                active
                  ? "inline-flex items-center gap-1.5 border-b-2 border-primary px-1 pb-2 text-sm font-medium text-foreground"
                  : "inline-flex items-center gap-1.5 border-b-2 border-transparent px-1 pb-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          )
        })}
      </nav>
      {children}
    </main>
  )
}
