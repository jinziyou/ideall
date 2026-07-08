// 本机内容 (笔记 / 关注 / 书签 / 资源 / 对话) 的可搜索条目: 唯一数据来源, 供 ⌘K 统一面板消费
// (顶栏搜索框唤起同一面板; 旧的独立本地搜索对话框已并入)。每项含 run() 执行:
// 笔记/资源/对话 → 打开实体节点标签; 书签 → 打开网址 (协议白名单); 关注 → 打开关注模块。

import type { ComponentType } from "react"
import { MessagesSquare } from "lucide-react"
import { safeHref } from "@/lib/safe-url"
import { listNotes } from "@/files/stores/notes-store"
import { listBookmarks } from "@/files/stores/bookmarks-store"
import { listFiles } from "@/files/stores/files-store"
import { listSubscriptions } from "@/files/stores/subscriptions-store"
import { listThreads } from "@/files/stores/threads-store"
import { MODULE_META } from "./module-meta"
import { openTab, openNodeTab } from "./store"
import { tabDescriptor } from "./tab-definitions"

export type LocalSearchGroup = "笔记" | "关注" | "书签" | "资源" | "对话"
export type LocalSearchItem = {
  id: string
  label: string
  group: LocalSearchGroup
  fileType?: { name: string; type: string }
  run: () => void
}

export const LOCAL_SEARCH_ORDER: LocalSearchGroup[] = ["笔记", "关注", "书签", "资源", "对话"]

// 图标从 MODULE_META 派生 (分组名是本文件的展示口径, 与模块 label 恰好一致但语义独立)。
export const LOCAL_SEARCH_ICON: Record<LocalSearchGroup, ComponentType<{ className?: string }>> = {
  笔记: MODULE_META.notes.icon,
  关注: MODULE_META.subscriptions.icon,
  书签: MODULE_META.bookmarks.icon,
  资源: MODULE_META.resources.icon,
  对话: MessagesSquare,
}

const SUBSCRIPTIONS_TAB = tabDescriptor("subscriptions")
const BOOKMARKS_TAB = tabDescriptor("home-bookmarks")

/** 并行加载本机内容并构建可搜索/可执行条目 (按 笔记→关注→书签→资源→对话 顺序)。 */
export async function loadLocalSearchItems(): Promise<LocalSearchItem[]> {
  const [notes, bms, files, subs, threads] = await Promise.all([
    listNotes(),
    listBookmarks(),
    listFiles(),
    listSubscriptions(),
    // 对话即文件 (§6.5): thread 与笔记平级可搜。单仓失败不拖垮整个搜索面。
    listThreads().catch(() => []),
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
      fileType: { name: f.name, type: f.type },
      run: () => openNodeTab({ kind: "file", id: f.id }, f.name),
    })
  // 对话 → 打开该 thread 的只读查看器标签 (thread-viewer 内可一键回 AI 栏继续)。
  for (const t of threads)
    items.push({
      id: "t" + t.id,
      label: t.title || "未命名对话",
      group: "对话",
      run: () => openNodeTab({ kind: "thread", id: t.id }, t.title || "未命名对话"),
    })
  return items
}
