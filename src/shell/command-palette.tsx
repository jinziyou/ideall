"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Bookmark, Copy, DownloadCloud, Globe, Hexagon, RefreshCw, SunMoon } from "lucide-react"
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
} from "@/ui/command"
import { setThemeChoice } from "@/lib/theme"
import { getSyncCode, subscribeSyncCode } from "@/lib/sync-code"
import { checkForUpdate } from "@/lib/updater"
import { isTauri } from "@/lib/tauri"
import { CMDK_OPEN, openCommandPalette } from "@/lib/command-palette-bus"
import { getSyncPort } from "@protocol/sync"
import { SUBSCRIPTIONS_SYNCED } from "@protocol/flowback"
import { HOME_SUBPAGES, SPOKES } from "@/shell/nav-config"

// openCommandPalette / CMDK_OPEN 已抽到 @/lib/command-palette-bus (纯事件总线),
// 使 components 的触发器无需反向 import app/shell; 此处 re-export 维持既有 ./command-palette 导入点。
export { openCommandPalette }

/**
 * ⌘K 命令台 —— 全局唯一实例 (挂根布局)。浮层引擎: 跳发现模块 (资讯/社区/工具) 或我的各子区,
 * 并可直接执行系统命令 (切深浅色 / 立即同步 / 复制同步码)。
 * 由 ⌘K / Ctrl+K 或任意 openCommandPalette() 触发器 (图标轨 / 移动顶栏 / 各页页头) 唤起。
 */
export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const code = React.useSyncExternalStore(subscribeSyncCode, getSyncCode, () => null)
  // updater 仅桌面 (Tauri) 生效; 取常量快照 (SSR / web = false), 避免 effect 内同步 setState 的级联渲染 lint。
  const isDesktop = React.useSyncExternalStore(
    () => () => {},
    isTauri,
    () => false,
  )

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    function onOpen() {
      setOpen(true)
    }
    document.addEventListener("keydown", onKey)
    window.addEventListener(CMDK_OPEN, onOpen)
    return () => {
      document.removeEventListener("keydown", onKey)
      window.removeEventListener(CMDK_OPEN, onOpen)
    }
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
        toast.success(r.added > 0 ? `同步完成 · 新增 ${r.added} 项` : "同步完成")
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

  function checkUpdate() {
    setOpen(false)
    void (async () => {
      const id = toast.loading("正在检查更新…")
      const r = await checkForUpdate()
      if (r === "updated") toast.success("已下载新版本，重启后生效", { id })
      else if (r === "uptodate") toast.success("已是最新版本", { id })
      else if (r === "error") toast.error("检查更新失败（更新服务可能未配置）", { id })
      else toast.dismiss(id) // unsupported: 理论上不会到 (仅桌面显示该命令)
    })()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="跳到书签、切换主题、同步数据…" />
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
          {/* 浏览器 = 内嵌 webview, 仅桌面 App; 移动端不放此入口 (无法工作)。 */}
          {isDesktop && (
            <CommandItem value="发现 浏览器 browser web 网页" onSelect={() => go("/browser")}>
              <Globe className="h-4 w-4" />
              浏览器
              <CommandShortcut className="font-mono">/browser</CommandShortcut>
            </CommandItem>
          )}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="我的">
          {HOME_SUBPAGES.map((p) => (
            <CommandItem key={p.href} value={`我的 ${p.label}`} onSelect={() => go(p.href)}>
              <p.icon className="h-4 w-4" />
              {p.label}
              <CommandShortcut className="font-mono">{p.href}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="系统服务">
          <CommandItem value="切换深浅色 主题 theme dark" onSelect={toggleTheme}>
            <SunMoon className="h-4 w-4" />
            切换深浅色
          </CommandItem>
          {/* 同步入口始终存在: 未配置同步码时给「开启」入口 (跳关注页顶部的 SyncPanel),
              避免新用户在唯一命令台里搜不到同步而误以为没有该功能。 */}
          {code ? (
            <>
              <CommandItem value="立即同步 跨端 sync" onSelect={() => syncNow(code)}>
                <RefreshCw className="h-4 w-4" />
                立即同步
              </CommandItem>
              <CommandItem value="复制同步码 跨端 sync copy" onSelect={() => copySyncCode(code)}>
                <Copy className="h-4 w-4" />
                复制同步码
              </CommandItem>
            </>
          ) : (
            <CommandItem
              value="开启跨端同步 setup sync 同步码"
              onSelect={() => go("/home/subscriptions")}
            >
              <RefreshCw className="h-4 w-4" />
              开启跨端同步…
            </CommandItem>
          )}
          <CommandItem value="去新建书签 收藏" onSelect={() => go("/home/bookmarks")}>
            <Bookmark className="h-4 w-4" />
            去新建书签
          </CommandItem>
          <CommandItem value="回到「我的」 home 概览 dashboard" onSelect={() => go("/home")}>
            <Hexagon className="h-4 w-4" />
            回到「我的」
          </CommandItem>
          {isDesktop && (
            <CommandItem value="检查更新 update 升级 upgrade" onSelect={checkUpdate}>
              <DownloadCloud className="h-4 w-4" />
              检查更新
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
