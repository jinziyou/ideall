import Link from "next/link"
import { ChevronRight, CornerDownLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatTime } from "@/lib/format"

/** 一条「关注」记录: 把发现模块的对象 / 资源加入「我的」的一次动作。 */
export type FlowItem = {
  id: string
  ts: number
  /** 圆点色 (Tailwind bg-* 类): 板块色做分类, bg-pop 表示落入本地的「我的」 */
  dotClass: string
  label: string
  title: string
  href: string
}

const GROUP_ORDER = ["今天", "本周", "更早"] as const
type GroupName = (typeof GROUP_ORDER)[number]

function groupOf(ts: number): GroupName {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  if (ts >= startOfToday.getTime()) return "今天"
  // 本周一 00:00 (周日 getDay()===0 视为本周末, 回退 6 天)；按日历周而非滚动 7 天
  const weekday = startOfToday.getDay()
  const mondayOffset = weekday === 0 ? 6 : weekday - 1
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setDate(startOfToday.getDate() - mondayOffset)
  if (ts >= startOfWeek.getTime()) return "本周"
  return "更早"
}

/**
 * 「最近关注」时间线 —— 重新设计的主时间线: 关注第一次有了肉眼可见的呈现位置。
 * 跨 subscriptions / bookmarks / files 按时间倒序合并, 分今天 / 本周 / 更早。
 */
export function RecentFlowback({ items }: { items: FlowItem[] }) {
  const groups = GROUP_ORDER.map((name) => ({
    name,
    items: items.filter((it) => groupOf(it.ts) === name),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.name}>
          <div className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
            <CornerDownLeft className="h-3 w-3" />
            {group.name}
          </div>
          <ol className="relative ml-1 border-l border-border pl-4">
            {group.items.map((it) => (
              <li key={it.id} className="relative flex items-center gap-3 py-1.5">
                <span
                  className={cn(
                    "absolute -left-[21px] h-2.5 w-2.5 rounded-full ring-2 ring-card",
                    it.dotClass,
                  )}
                />
                <Link
                  href={it.href}
                  className="flex min-w-0 flex-1 items-center gap-2 text-sm hover:underline"
                >
                  <span className="shrink-0 text-muted-foreground">{it.label}</span>
                  <span className="truncate font-medium">{it.title}</span>
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatTime(it.ts)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}
      <Link
        href="/home/subscriptions"
        className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:text-pop"
      >
        查看全部
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  )
}
