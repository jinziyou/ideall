import { Bookmark, Bot, FolderOpen, Rss } from "lucide-react"
import type { ComponentType } from "react"
import { cn } from "@/components/lib/utils"

type Props = {
  subs: number
  bookmarks: number
  files: number
  threads: number
}

type Tile = {
  key: keyof Props
  label: string
  icon: ComponentType<{ className?: string }>
  /** 便当 tint (重要度/分类着色); 缺省为素白卡 */
  tint?: string
  num?: string
}

const TILES: Tile[] = [
  {
    key: "subs",
    label: "订阅",
    icon: Rss,
    tint: "bg-spoke-info/10 border-spoke-info/25",
    num: "text-spoke-info",
  },
  { key: "bookmarks", label: "书签", icon: Bookmark },
  { key: "files", label: "资源", icon: FolderOpen },
  {
    key: "threads",
    label: "对话",
    icon: Bot,
    tint: "bg-primary/10 border-primary/25",
    num: "text-primary",
  },
]

/**
 * 中枢「所有权一览」便当磁贴 —— 纯本地计数, tabular-nums 给工程感;
 * 订阅 / 对话以三辐 / 强调色微 tint 表达分类。本地存储用量见左侧上下文栏。
 */
export function HubStatTiles(props: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES.map((t) => (
        <div key={t.key} className={cn("rounded-2xl border bg-card p-4 shadow-sm", t.tint)}>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </div>
          <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums", t.num)}>
            {props[t.key]}
          </div>
        </div>
      ))}
    </div>
  )
}
