"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bot, Compass, Search } from "lucide-react"

const tabs = [
  { href: "/tool/search", label: "搜索", icon: Search },
  { href: "/tool/ai", label: "AI", icon: Bot },
  { href: "/tool/navigation", label: "导航", icon: Compass },
]

export default function ToolLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <main className="m-2 flex flex-col gap-4 sm:m-4">
      <nav className="inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
        {tabs.map(({ href, label, icon: Icon }) => {
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
      {children}
    </main>
  )
}
