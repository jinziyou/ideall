import type { Subscription } from "@protocol/subscription"
import { listBookmarks } from "@/files/stores/bookmarks-store"
import { listFiles } from "@/files/stores/files-store"
import { listNotes } from "@/files/stores/notes-store"
import { listSubscriptions } from "@/files/stores/subscriptions-store"
import { listThreads } from "@/files/stores/threads-store"
import { SUB_SPOKE_META } from "./subscriptions/subscription-meta"

export type HomeActivityItem = {
  id: string
  ts: number
  dotClass: string
  label: string
  title: string
  href: string
  fileType?: { name: string; type: string }
}

export type HomeCounts = Record<string, number | undefined>

export type HomeOverviewData = {
  counts: HomeCounts
  activity: HomeActivityItem[]
}

type BookmarkFlowInput = { id: string; title: string; createdAt: number }
type FileFlowInput = { id: string; name: string; type: string; createdAt: number }
type NoteFlowInput = { id: string; title: string; createdAt: number }

export type HomeOverviewInput = {
  subs: Subscription[]
  bookmarks: BookmarkFlowInput[]
  files: FileFlowInput[]
  notes: NoteFlowInput[]
  threads: unknown[]
}

export function buildHomeActivity({
  subs,
  bookmarks,
  files,
  notes,
}: Pick<HomeOverviewInput, "subs" | "bookmarks" | "files" | "notes">): HomeActivityItem[] {
  const items: HomeActivityItem[] = []
  for (const n of notes) {
    items.push({
      id: `note:${n.id}`,
      ts: n.createdAt,
      dotClass: "bg-pop",
      label: "写笔记",
      title: n.title || "无标题",
      href: "/home/notes",
    })
  }
  for (const s of subs) {
    const m = SUB_SPOKE_META[s.type]
    items.push({
      id: `sub:${s.id}`,
      ts: s.createdAt,
      dotClass: m.dotClass,
      label: m.actionLabel,
      title: s.title,
      href: "/home/subscriptions",
    })
  }
  for (const b of bookmarks) {
    items.push({
      id: `bm:${b.id}`,
      ts: b.createdAt,
      dotClass: "bg-pop",
      label: "书签",
      title: b.title,
      href: "/home/bookmarks",
    })
  }
  for (const f of files) {
    items.push({
      id: `f:${f.id}`,
      ts: f.createdAt,
      dotClass: "bg-pop",
      label: "添加资源",
      title: f.name,
      href: "/home/resources",
      fileType: { name: f.name, type: f.type },
    })
  }
  return items.sort((a, b) => b.ts - a.ts).slice(0, 12)
}

export function createHomeOverviewData(input: HomeOverviewInput): HomeOverviewData {
  return {
    counts: {
      subscriptions: input.subs.filter((s) => s.type !== "tool").length,
      bookmarks: input.bookmarks.length,
      resources: input.files.length,
      notes: input.notes.length,
      workspace: input.threads.length,
    },
    activity: buildHomeActivity(input),
  }
}

export async function loadHomeOverviewData(): Promise<HomeOverviewData> {
  const [subs, bookmarks, files, notes, threads] = await Promise.all([
    listSubscriptions().catch(() => [] as Subscription[]),
    listBookmarks().catch(() => []),
    listFiles().catch(() => []),
    listNotes({ text: false }).catch(() => []),
    listThreads().catch(() => []),
  ])
  return createHomeOverviewData({ subs, bookmarks, files, notes, threads })
}
