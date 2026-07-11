"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AudioLines,
  Bookmark,
  Braces,
  Code2,
  Copy,
  Database,
  DownloadCloud,
  Files,
  Globe,
  Hexagon,
  Layers,
  LayoutGrid,
  NotebookPen,
  RefreshCw,
  SunMoon,
  Terminal,
  Trash2,
  X,
} from "lucide-react"
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
import {
  loadLocalSearchItems,
  LOCAL_SEARCH_ICON,
  LOCAL_SEARCH_ORDER,
  type LocalSearchItem,
} from "@/workspace/local-search-items"
import {
  getActiveId,
  openTarget,
  requestCloseActiveTab,
  requestCloseOtherTabs,
  setDevelopmentTool,
  setActiveTab,
  setWorkspaceKind,
  useActiveId,
  useLru,
  useTabs,
} from "@/workspace/store"
import { createNoteFile } from "@/modules/home/notes/note-file-system"
import { useShortcutLabel } from "@/lib/shortcuts"
import { FileTypeIcon } from "@/shared/file-type-icon"

const LOCAL_SEARCH_DEBOUNCE_MS = 160
const LOCAL_SEARCH_LIMIT_PER_GROUP = 20

// openCommandPalette / CMDK_OPEN 已抽到 @/lib/command-palette-bus (纯事件总线),
// 使 components 的触发器无需反向 import app/shell; 此处 re-export 维持既有 ./command-palette 导入点。
export { openCommandPalette }

/**
 * ⌘K 统一面板 —— 全局唯一实例 (挂根布局), 本地搜索与命令的单一入口 (顶栏搜索框同样唤起它)。
 * 直接输入 = 搜本机内容 (笔记/关注/书签/资源) + 匹配命令; 输入 `>` 前缀 = 只看命令 (VS Code 惯例)。
 * 实现: 全部命令项的 value 以 "> " 开头 —— cmdk 模糊匹配天然让 ">xxx" 只命中命令 (内容项 value 无 ">"),
 * 内容分组在命令模式下额外整组不渲染。命令: 跳发现模块 / 我的各子区 / 系统服务 (主题/同步/更新)。
 * 由 ⌘K / Ctrl+K 或任意 openCommandPalette() 触发器 (顶栏搜索框 / 移动顶栏 / 各页页头) 唤起。
 */
export default function CommandPalettePanel({ initialOpen = false }: { initialOpen?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(initialOpen)
  // 受控输入: 内容项 (笔记/书签/资源/关注) 仅在用户输入时才展示, 避免一打开就糊一屏本机内容
  // (⌘K 主要是命令/跳转入口; 内容搜索是兑现占位文案「跳到书签」的补充)。
  const [query, setQuery] = React.useState("")
  // `>` 前缀 = 命令模式 (只看命令): 内容分组整组不渲染; 匹配面靠命令 value 的 "> " 前缀天然收窄。
  const commandMode = query.trimStart().startsWith(">")
  const [content, setContent] = React.useState<LocalSearchItem[]>([])
  const [contentQuery, setContentQuery] = React.useState("")
  // 打开的标签 (LRU 最近优先, 排除当前激活项): ⌘K 是键盘用户定位已打开标签的唯一入口
  // (标签条截断后肉眼难扫; 桌面下拉与移动抽屉都是指点路径)。
  const tabs = useTabs()
  const activeTabId = useActiveId()
  const lru = useLru()
  const closeKbd = useShortcutLabel("mod+w")
  const openTabItems = React.useMemo(() => {
    const rank = new Map(lru.map((id, i) => [id, i]))
    return tabs
      .filter((t) => t.id !== activeTabId)
      .sort((a, b) => (rank.get(b.id) ?? -1) - (rank.get(a.id) ?? -1))
  }, [tabs, activeTabId, lru])
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
        setQuery("") // 每次开/关都清空, 下次打开回到命令视图 (在事件回调里重置, 不在 effect 体内同步 setState)
        setOpen((v) => !v)
      }
    }
    function onOpen() {
      setQuery("")
      setOpen(true)
    }
    document.addEventListener("keydown", onKey)
    window.addEventListener(CMDK_OPEN, onOpen)
    return () => {
      document.removeEventListener("keydown", onKey)
      window.removeEventListener(CMDK_OPEN, onOpen)
    }
  }, [])

  // 仅在用户输入内容搜索时按 query 下推到 FileSystem; 避免打开面板即全量加载本机数据。
  React.useEffect(() => {
    const text = query.trim()
    if (!open || commandMode || !text) return
    let alive = true
    const timer = window.setTimeout(() => {
      loadLocalSearchItems({ text, limitPerGroup: LOCAL_SEARCH_LIMIT_PER_GROUP })
        .then((items) => {
          if (!alive) return
          setContent(items)
          setContentQuery(text)
        })
        .catch(() => {
          /* 本地读取失败时静默, 仅退化为无内容搜索 */
        })
    }, LOCAL_SEARCH_DEBOUNCE_MS)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [open, commandMode, query])

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  function switchWorkspace(kind: "files" | "audio" | "development", tool?: "git" | "shell") {
    setOpen(false)
    setWorkspaceKind(kind)
    if (tool) setDevelopmentTool(tool)
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

  // 最高频捕获动作的 1 步入口: 直接建一篇并打开为节点标签 (与 notes-manager.handleNewRoot 同路径)。
  function newNote() {
    setOpen(false)
    void (async () => {
      try {
        const note = await createNoteFile(null)
        openTarget({
          type: "file",
          ref: note.ref,
          file: note,
          title: note.name || "无标题",
        })
      } catch (e) {
        toast.error("新建笔记失败", { description: String(e) })
      }
    })()
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
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="搜索本地内容、跳转或执行命令; 输入 > 只看命令…"
      />
      <CommandList>
        <CommandEmpty>没有匹配的内容或命令</CommandEmpty>
        {/* 打开的标签 (LRU 最近优先): 键盘定位已打开标签的第一入口, 空输入即展示 (VS Code Ctrl+P 惯例)。 */}
        {!commandMode && openTabItems.length > 0 && (
          <>
            <CommandGroup heading="打开的标签">
              {openTabItems.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`tab ${t.id}`}
                  keywords={[t.title]}
                  onSelect={() => {
                    setActiveTab(t.id)
                    setOpen(false)
                  }}
                >
                  <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{t.title}</span>
                  {t.path ? (
                    <CommandShortcut className="font-mono">{t.path}</CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        <CommandGroup heading="工作区">
          <CommandItem value="> 工作区 文件 默认" onSelect={() => switchWorkspace("files")}>
            <Files className="h-4 w-4" />
            文件
          </CommandItem>
          <CommandItem value="> 工作区 音频 播放" onSelect={() => switchWorkspace("audio")}>
            <AudioLines className="h-4 w-4" />
            音频
          </CommandItem>
          <CommandItem
            value="> 工作区 开发 Git"
            onSelect={() => switchWorkspace("development", "git")}
          >
            <Code2 className="h-4 w-4" />
            开发 · Git
          </CommandItem>
          <CommandItem
            value="> 工作区 开发 终端 Shell"
            onSelect={() => switchWorkspace("development", "shell")}
          >
            <Terminal className="h-4 w-4" />
            开发 · 终端
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="发现">
          {SPOKES.map((s) => (
            <CommandItem key={s.href} value={`> 发现 ${s.label}`} onSelect={() => go(s.href)}>
              <span className={`h-2 w-2 rounded-full ${s.dot}`} />
              {s.label}
              <CommandShortcut className="font-mono">{s.href}</CommandShortcut>
            </CommandItem>
          ))}
          {/* 浏览器 (内嵌 webview) 与 应用 (本机已装应用) 均仅桌面 App 可用; 移动端不放 (无法工作)。 */}
          {isDesktop && (
            <CommandItem value="> 发现 浏览器 browser web 网页" onSelect={() => go("/browser")}>
              <Globe className="h-4 w-4" />
              浏览器
              <CommandShortcut className="font-mono">/browser</CommandShortcut>
            </CommandItem>
          )}
          {isDesktop && (
            <CommandItem value="> 应用 apps 本机应用 installed 启动" onSelect={() => go("/apps")}>
              <LayoutGrid className="h-4 w-4" />
              应用
              <CommandShortcut className="font-mono">/apps</CommandShortcut>
            </CommandItem>
          )}
          {isDesktop && (
            <CommandItem value="> 数据库 database table db" onSelect={() => go("/database")}>
              <Database className="h-4 w-4" />
              数据库
              <CommandShortcut className="font-mono">/database</CommandShortcut>
            </CommandItem>
          )}
          {isDesktop && (
            <CommandItem value="> Code code 开发 diagnostics 诊断" onSelect={() => go("/code")}>
              <Braces className="h-4 w-4" />
              Code
              <CommandShortcut className="font-mono">/code</CommandShortcut>
            </CommandItem>
          )}
          <CommandItem value="> 回收站 trash deleted 删除 恢复" onSelect={() => go("/trash")}>
            <Trash2 className="h-4 w-4" />
            回收站
            <CommandShortcut className="font-mono">/trash</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="我的">
          {/* 最高频捕获动作 (记一条笔记) 的 1 步入口, 置组首。 */}
          <CommandItem value="> 新建笔记 new note 记录 写作" onSelect={newNote}>
            <NotebookPen className="h-4 w-4" />
            新建笔记
          </CommandItem>
          {HOME_SUBPAGES.map((p) => (
            <CommandItem key={p.href} value={`> 我的 ${p.label}`} onSelect={() => go(p.href)}>
              <p.icon className="h-4 w-4" />
              {p.label}
              <CommandShortcut className="font-mono">{p.href}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="标签">
          <CommandItem
            value="> 关闭当前标签 close tab"
            onSelect={() => {
              setOpen(false)
              requestCloseActiveTab()
            }}
          >
            <X className="h-4 w-4" />
            关闭当前标签
            <CommandShortcut>{closeKbd}</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="> 关闭其他标签 close other tabs"
            onSelect={() => {
              setOpen(false)
              const id = getActiveId()
              if (id) requestCloseOtherTabs(id)
            }}
          >
            <Layers className="h-4 w-4" />
            关闭其他标签
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="系统服务">
          <CommandItem value="> 切换深浅色 主题 theme dark" onSelect={toggleTheme}>
            <SunMoon className="h-4 w-4" />
            切换深浅色
          </CommandItem>
          {/* 同步入口始终存在: 未配置同步码时给「开启」入口 (跳关注页顶部的 SyncPanel),
              避免新用户在唯一命令面板里搜不到同步而误以为没有该功能。 */}
          {code ? (
            <>
              <CommandItem value="> 立即同步 跨端 sync" onSelect={() => syncNow(code)}>
                <RefreshCw className="h-4 w-4" />
                立即同步
              </CommandItem>
              <CommandItem value="> 复制同步码 跨端 sync copy" onSelect={() => copySyncCode(code)}>
                <Copy className="h-4 w-4" />
                复制同步码
              </CommandItem>
            </>
          ) : (
            <CommandItem
              value="> 开启跨端同步 setup sync 同步码"
              onSelect={() => go("/home/subscriptions")}
            >
              <RefreshCw className="h-4 w-4" />
              开启跨端同步…
            </CommandItem>
          )}
          <CommandItem value="> 去新建书签 收藏" onSelect={() => go("/home/bookmarks")}>
            <Bookmark className="h-4 w-4" />
            去新建书签
          </CommandItem>
          <CommandItem value="> 回到「我的」 home 概览 dashboard" onSelect={() => go("/home")}>
            <Hexagon className="h-4 w-4" />
            回到「我的」
          </CommandItem>
          {isDesktop && (
            <CommandItem value="> 检查更新 update 升级 upgrade" onSelect={checkUpdate}>
              <DownloadCloud className="h-4 w-4" />
              检查更新
            </CommandItem>
          )}
        </CommandGroup>
        {/* 本机内容 (笔记/关注/书签/资源): 仅在输入且非命令模式时展示, 按标题模糊匹配 (cmdk 据 keywords 过滤)。 */}
        {!commandMode && query.trim() && contentQuery === query.trim() && content.length > 0
          ? LOCAL_SEARCH_ORDER.map((g) => {
              const gi = content.filter((i) => i.group === g)
              if (gi.length === 0) return null
              const Icon = LOCAL_SEARCH_ICON[g]
              return (
                <React.Fragment key={g}>
                  <CommandSeparator />
                  <CommandGroup heading={g}>
                    {gi.map((i) => (
                      <CommandItem
                        key={i.id}
                        value={i.id}
                        keywords={[i.label]}
                        onSelect={() => {
                          i.run()
                          setOpen(false)
                        }}
                      >
                        {i.fileType ? (
                          <FileTypeIcon
                            name={i.fileType.name}
                            type={i.fileType.type}
                            className="h-4 w-4 shrink-0"
                          />
                        ) : (
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{i.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </React.Fragment>
              )
            })
          : null}
      </CommandList>
    </CommandDialog>
  )
}
