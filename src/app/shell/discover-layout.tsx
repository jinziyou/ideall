import Link from "next/link"
import { CornerDownLeft } from "lucide-react"
import DiscoverNav from "./discover-nav"

export const metadata = {
  title: "发现 | wonita",
  description: "资讯、社区与工具的聚合入口。订阅后回流到「我的」。",
}

/**
 * 「发现」分区布局: 把 info / community / tool 三个聚合模块统一到「发现」之下,
 * 共享顶部分区导航 + 右侧「回流去向」锚点 (hub-and-spoke 视觉词汇: 发现订阅后回流到「我的」中枢)。
 * 各模块页面自带 <main>, 故此处只用 <div> 包裹, 避免 <main> 嵌套。
 */
export default function DiscoverLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2 sm:px-4 sm:pt-4">
        <DiscoverNav />
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 rounded-full border border-pop/25 bg-pop/[0.06] px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-pop/10 hover:text-foreground"
          title="订阅与收藏回流到「我的」"
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
          回流去向 · <span className="font-medium text-foreground">我的</span>
        </Link>
      </div>
      {children}
    </div>
  )
}
