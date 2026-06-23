"use client"

// 顶栏「本地搜索」: 在本机数据 (笔记 / 订阅 / 关注 / 书签 / 资源) 中按标题检索。
// 选中: 笔记/资源/订阅/关注 → 打开对应模块标签; 书签 → 直接打开其网址。

import * as React from "react"
import { Bookmark, FolderOpen, NotebookPen, Rss, UserRound } from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { safeHref } from "@/components/lib/safe-url"
import { listNotes } from "@/app/home/lib/notes-store"
import { listBookmarks } from "@/app/home/lib/bookmarks-store"
import { listFiles } from "@/app/home/lib/files-store"
import { listSubscriptions } from "@/app/home/lib/subscriptions-store"
import { openTab } from "./store"
import type { TabDescriptor } from "./types"

type Group = "笔记" | "订阅" | "关注" | "书签" | "资源"
type Item = { id: string; label: string; group: Group; run: () => void }

const ORDER: Group[] = ["笔记", "订阅", "关注", "书签", "资源"]
const ICON: Record<Group, React.ComponentType<{ className?: string }>> = {
  笔记: NotebookPen,
  订阅: Rss,
  关注: UserRound,
  书签: Bookmark,
  资源: FolderOpen,
}

const TAB: Record<string, TabDescriptor> = {
  notes: { kind: "home-notes", module: "home", title: "笔记", path: "/home/notes" },
  resources: { kind: "home-resources", module: "home", title: "资源", path: "/home/resources" },
  bookmarks: { kind: "home-bookmarks", module: "home", title: "书签", path: "/home/bookmarks" },
  subscriptions: {
    kind: "subscriptions",
    module: "subscriptions",
    title: "订阅",
    path: "/home/subscriptions",
  },
  following: { kind: "following", module: "following", title: "关注", path: "/home/following" },
}

export default function LocalSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [items, setItems] = React.useState<Item[]>([])

  React.useEffect(() => {
    if (!open) return
    let alive = true
    async function load() {
      try {
        const [notes, bms, files, subs] = await Promise.all([
          listNotes(),
          listBookmarks(),
          listFiles(),
          listSubscriptions(),
        ])
        if (!alive) return
        const next: Item[] = []
        for (const n of notes)
          next.push({
            id: "n" + n.id,
            label: n.title || "无标题笔记",
            group: "笔记",
            run: () => openTab(TAB.notes),
          })
        for (const s of subs) {
          const peer = s.type === "peer"
          next.push({
            id: "s" + s.id,
            label: s.title || "未命名订阅",
            group: peer ? "关注" : "订阅",
            run: () => openTab(peer ? TAB.following : TAB.subscriptions),
          })
        }
        for (const b of bms)
          next.push({
            id: "b" + b.id,
            label: b.title || "未命名书签",
            group: "书签",
            run: () => {
              const h = safeHref(b.url)
              if (h) window.open(h, "_blank", "noopener,noreferrer")
              else openTab(TAB.bookmarks)
            },
          })
        for (const f of files)
          next.push({ id: "f" + f.id, label: f.name, group: "资源", run: () => openTab(TAB.resources) })
        setItems(next)
      } catch {
        /* 本地读取失败时静默 */
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [open])

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="本地搜索"
      description="搜索本机的笔记 / 订阅 / 关注 / 书签 / 资源"
    >
      <CommandInput placeholder="搜索本地内容…" />
      <CommandList>
        <CommandEmpty>没有匹配的本地内容</CommandEmpty>
        {ORDER.map((g) => {
          const gi = items.filter((i) => i.group === g)
          if (gi.length === 0) return null
          const Icon = ICON[g]
          return (
            <CommandGroup key={g} heading={g}>
              {gi.map((i) => (
                <CommandItem
                  key={i.id}
                  value={i.id}
                  keywords={[i.label]}
                  onSelect={() => {
                    i.run()
                    onOpenChange(false)
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{i.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )
        })}
      </CommandList>
    </CommandDialog>
  )
}
