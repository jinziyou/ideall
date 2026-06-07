import { Bookmark, Bot, FolderOpen, HardDrive, Rss } from "lucide-react"
import { formatBytes } from "@/lib/hub-format"

type Props = {
  subs: number
  bookmarks: number
  files: number
  threads: number
  usage: number
  quota: number
}

/** 中枢「所有权一览」—— 纯本地计数 + 本地存储用量。数字用 tabular-nums 给工程感。 */
export function HubStatTiles({ subs, bookmarks, files, threads, usage, quota }: Props) {
  const tiles = [
    { label: "订阅", value: subs, icon: Rss },
    { label: "书签", value: bookmarks, icon: Bookmark },
    { label: "资源", value: files, icon: FolderOpen },
    { label: "对话", value: threads, icon: Bot },
  ]
  const pct = quota > 0 ? Math.min(100, (usage / quota) * 100) : 0

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map(({ label, value, icon: Icon }) => (
        <div key={label} className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
            {label}
          </div>
          <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</div>
        </div>
      ))}
      <div className="col-span-2 rounded-xl border bg-card p-4 shadow-sm sm:col-span-3 lg:col-span-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <HardDrive className="h-3.5 w-3.5" />
          本地存储
        </div>
        <div className="mt-1.5 text-sm font-medium tabular-nums">
          {quota > 0 ? `${formatBytes(usage)} / ${formatBytes(quota)}` : formatBytes(usage)}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-pop transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}
