"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Bookmark, Hexagon, Search } from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { HOME_SUBPAGES, SPOKES } from "./nav-config"

/**
 * ⌘K 中枢命令台 —— 接管原先死掉的搜索框。统一入口: 跳 spoke / 跳我的空间子区。
 * 触发器形如搜索框, 点它或按 ⌘K / Ctrl+K 打开。
 */
export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent sm:w-[240px] lg:w-[300px]"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">跳转到…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-sans text-[10px] sm:inline">⌘K</kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="跳转到… (资讯 / 社区 / 工具 / 我的空间)" />
        <CommandList>
          <CommandEmpty>没有匹配项</CommandEmpty>
          <CommandGroup heading="发现">
            {SPOKES.map((s) => (
              <CommandItem key={s.href} value={`发现 ${s.label}`} onSelect={() => go(s.href)}>
                <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                {s.label}
                <CommandShortcut>spoke</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="我的空间">
            {HOME_SUBPAGES.map((p) => (
              <CommandItem key={p.href} value={`我的空间 ${p.label}`} onSelect={() => go(p.href)}>
                <p.icon className="h-4 w-4" />
                {p.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="操作">
            <CommandItem value="新建书签 收藏" onSelect={() => go("/home/bookmarks")}>
              <Bookmark className="h-4 w-4" />
              新建书签
            </CommandItem>
            <CommandItem value="打开中枢概览 dashboard" onSelect={() => go("/home")}>
              <Hexagon className="h-4 w-4" />
              打开中枢概览
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
