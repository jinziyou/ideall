// 本机内容 (笔记 / 关注 / 书签 / 资源) 的可搜索条目: 唯一数据来源, 供顶栏「本地搜索」对话框与
// ⌘K 命令面板共用 (避免两处各自加载/构建)。每项含 run() 执行: 笔记/资源 → 打开实体节点标签;
// 书签 → 打开网址 (协议白名单); 关注 → 打开关注模块。

import type { ComponentType } from "react"
import { safeHref } from "@/lib/safe-url"
import { listNotes } from "@/files/stores/notes-store"
import { listBookmarks } from "@/files/stores/bookmarks-store"
import { listFiles } from "@/files/stores/files-store"
import { listSubscriptions } from "@/files/stores/subscriptions-store"
import { MODULE_META } from "./module-meta"
import { openTab, openNodeTab } from "./store"
import type { TabDescriptor } from "./types"

export type LocalSearchGroup = "笔记" | "关注" | "书签" | "资源"
export type LocalSearchItem = {
  id: string
  label: string
  group: LocalSearchGroup
  run: () => void
}

export const LOCAL_SEARCH_ORDER: LocalSearchGroup[] = ["笔记", "关注", "书签", "资源"]

// 图标从 MODULE_META 派生 (分组名是本文件的展示口径, 与模块 label 恰好一致但语义独立)。
export const LOCAL_SEARCH_ICON: Record<LocalSearchGroup, ComponentType<{ className?: string }>> = {
  笔记: MODULE_META.notes.icon,
  关注: MODULE_META.subscriptions.icon,
  书签: MODULE_META.bookmarks.icon,
  资源: MODULE_META.resources.icon,
}

const SUBSCRIPTIONS_TAB: TabDescriptor = {
  kind: "subscriptions",
  module: "subscriptions",
  title: "关注",
  path: "/home/subscriptions",
}
const BOOKMARKS_TAB: TabDescriptor = {
  kind: "home-bookmarks",
  module: "home",
  title: "书签",
  path: "/home/bookmarks",
}

/** 并行加载本机内容并构建可搜索/可执行条目 (按 笔记→关注→书签→资源 顺序)。 */
export async function loadLocalSearchItems(): Promise<LocalSearchItem[]> {
  const [notes, bms, files, subs] = await Promise.all([
    listNotes(),
    listBookmarks(),
    listFiles(),
    listSubscriptions(),
  ])
  const items: LocalSearchItem[] = []
  // 笔记: 打开「该篇」为独立节点标签 (一切皆标签), 而非笼统跳到笔记列表。
  for (const n of notes)
    items.push({
      id: "n" + n.id,
      label: n.title || "无标题笔记",
      group: "笔记",
      run: () => openNodeTab({ kind: "note", id: n.id }, n.title || "无标题笔记"),
    })
  for (const s of subs)
    items.push({
      id: "s" + s.id,
      label: s.title || "未命名关注",
      group: "关注",
      run: () => openTab(SUBSCRIPTIONS_TAB),
    })
  for (const b of bms)
    items.push({
      id: "b" + b.id,
      label: b.title || "未命名书签",
      group: "书签",
      run: () => {
        const h = safeHref(b.url)
        if (h) window.open(h, "_blank", "noopener,noreferrer")
        else openTab(BOOKMARKS_TAB)
      },
    })
  // 文件已有查看器 → 打开「该文件」实体标签 (与笔记一致); 不再笼统跳资源管理器。
  for (const f of files)
    items.push({
      id: "f" + f.id,
      label: f.name,
      group: "资源",
      run: () => openNodeTab({ kind: "file", id: f.id }, f.name),
    })
  return items
}
