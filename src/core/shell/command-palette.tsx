"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Bookmark, Copy, Hexagon, RefreshCw, Search, SunMoon } from "lucide-react"
import { toast } from "sonner"
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
import { setThemeChoice } from "@/lib/theme"
import { getSyncCode, subscribeSyncCode } from "@/lib/sync-code"
import { getSyncPort } from "@protocol/sync"
import { SUBSCRIPTIONS_SYNCED } from "@protocol/flowback"
import { HOME_SUBPAGES, SPOKES } from "@core/nav/nav-config"

/**
 * ⌘K 中枢命令台: 全站统一入口 —— 跳 spoke (发现下的资讯/社区/工具) 或我的空间各子区,
 * 并可直接执行系统命令 (切深浅色 / 立即同步 / 复制同步码)。
 * 触发器形如搜索框, 点它或按 ⌘K / Ctrl+K 打开。
 */
export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const code = React.useSyncExternalStore(subscribeSyncCode, getSyncCode, () => null)

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

  function toggleTheme() {
    setOpen(false)
    setThemeChoice(document.documentElement.classList.contains("dark") ? "light" : "dark")
  }

  function syncNow(c: string) {
    setOpen(false)
    void (async () => {
      try {
        const port = getSyncPort()
        if (!port) throw new Error("同步功能不可用")
        const r = await port.syncNow(c)
        window.dispatchEvent(new Event(SUBSCRIPTIONS_SYNCED))
        toast.success(r.added > 0 ? `同步完成 · 合并 ${r.added} 项已落本机` : "同步完成")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "同步失败")
      }
    })()
  }

  function copySyncCode(c: string) {
    setOpen(false)
    navigator.clipboard?.writeText(c).then(
      () => toast.success("同步码已复制"),
      () => toast.error("复制失败"),
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent sm:w-[240px] md:w-[150px] lg:w-[240px] xl:w-[300px]"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">命令 / 跳转…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-sans text-[10px] lg:inline">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="输入命令, 或跳到任意位置…" />
        <CommandList>
          <CommandEmpty>没有匹配的命令或位置</CommandEmpty>
          <CommandGroup heading="发现">
            {SPOKES.map((s) => (
              <CommandItem key={s.href} value={`发现 ${s.label}`} onSelect={() => go(s.href)}>
                <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                {s.label}
                <CommandShortcut className="font-mono">{s.href}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="我的空间">
            {HOME_SUBPAGES.map((p) => (
              <CommandItem key={p.href} value={`我的空间 ${p.label}`} onSelect={() => go(p.href)}>
                <p.icon className="h-4 w-4" />
                {p.label}
                <CommandShortcut className="font-mono">{p.href}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="系统">
            <CommandItem value="切换深浅色 主题 theme dark" onSelect={toggleTheme}>
              <SunMoon className="h-4 w-4" />
              切换深浅色
            </CommandItem>
            {code && (
              <CommandItem value="立即同步 跨端 sync" onSelect={() => syncNow(code)}>
                <RefreshCw className="h-4 w-4" />
                立即同步
              </CommandItem>
            )}
            {code && (
              <CommandItem value="复制同步码 跨端 sync copy" onSelect={() => copySyncCode(code)}>
                <Copy className="h-4 w-4" />
                复制同步码
              </CommandItem>
            )}
            <CommandItem value="去新建书签 收藏" onSelect={() => go("/home/bookmarks")}>
              <Bookmark className="h-4 w-4" />
              去新建书签
            </CommandItem>
            <CommandItem value="回到我的空间 中枢 概览 dashboard" onSelect={() => go("/home")}>
              <Hexagon className="h-4 w-4" />
              回到我的空间
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
