import type { DirectoryEntry } from "@protocol/file-system"
import type { Subscription, SubscriptionType } from "@protocol/subscription"
import { walkFileDirectory } from "@/filesystem/directory-walk"
import {
  corePlaceRef,
  resourceRefForFile,
  type CorePlaceId,
} from "@/filesystem/resource-file-system"
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
      label: "文件",
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

const DIRECTORY_CONTEXT = { actor: "ui", permissions: [], intent: "directory" } as const
const SUBSCRIPTION_TYPES: SubscriptionType[] = ["publisher", "entity", "tool", "search", "peer"]

function timestamp(entry: DirectoryEntry, key: "createdAt" | "updatedAt"): number {
  const value = entry.properties?.[key]
  return typeof value === "number" ? value : 0
}

async function nodeEntries(
  place: CorePlaceId,
  descendKind?: "folder" | "note",
): Promise<DirectoryEntry[]> {
  return (
    await walkFileDirectory(corePlaceRef(place), DIRECTORY_CONTEXT, (entry) => {
      const resource = resourceRefForFile(entry.target)
      return Boolean(descendKind && resource?.scheme === "node" && resource.kind === descendKind)
    })
  ).filter((entry) => resourceRefForFile(entry.target)?.scheme === "node")
}

function subscriptionFromEntry(entry: DirectoryEntry): Subscription | null {
  const resource = resourceRefForFile(entry.target)
  const type = entry.properties?.subscriptionType
  const key = entry.properties?.subscriptionKey
  if (
    resource?.scheme !== "node" ||
    resource.kind !== "feed" ||
    typeof type !== "string" ||
    !SUBSCRIPTION_TYPES.includes(type as SubscriptionType) ||
    typeof key !== "string"
  ) {
    return null
  }
  return {
    id: resource.id,
    type: type as SubscriptionType,
    key,
    title: entry.name,
    favicon: "",
    createdAt: timestamp(entry, "createdAt"),
    updatedAt: timestamp(entry, "updatedAt"),
  }
}

export async function loadHomeOverviewData(): Promise<HomeOverviewData> {
  const [subEntries, bookmarkEntries, fileEntries, noteEntries, threadEntries] = await Promise.all([
    nodeEntries("subscriptions").catch(() => []),
    nodeEntries("bookmarks", "folder").catch(() => []),
    nodeEntries("files").catch(() => []),
    nodeEntries("notes", "note").catch(() => []),
    nodeEntries("workspace").catch(() => []),
  ])
  const subs = subEntries.flatMap((entry) => {
    const value = subscriptionFromEntry(entry)
    return value ? [value] : []
  })
  const bookmarks = bookmarkEntries.flatMap((entry) => {
    const resource = resourceRefForFile(entry.target)
    return resource?.scheme === "node" && resource.kind === "bookmark"
      ? [{ id: resource.id, title: entry.name, createdAt: timestamp(entry, "createdAt") }]
      : []
  })
  const files = fileEntries.flatMap((entry) => {
    const resource = resourceRefForFile(entry.target)
    return resource?.scheme === "node" && resource.kind === "file"
      ? [
          {
            id: resource.id,
            name: entry.name,
            type:
              typeof entry.properties?.mediaType === "string"
                ? entry.properties.mediaType
                : "application/octet-stream",
            createdAt: timestamp(entry, "createdAt"),
          },
        ]
      : []
  })
  const notes = noteEntries.flatMap((entry) => {
    const resource = resourceRefForFile(entry.target)
    return resource?.scheme === "node" && resource.kind === "note"
      ? [{ id: resource.id, title: entry.name, createdAt: timestamp(entry, "createdAt") }]
      : []
  })
  const threads = threadEntries.filter((entry) => {
    const resource = resourceRefForFile(entry.target)
    return resource?.scheme === "node" && resource.kind === "thread"
  })
  return createHomeOverviewData({ subs, bookmarks, files, notes, threads })
}
