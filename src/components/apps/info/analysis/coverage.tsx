"use client"

import { ExternalLink, Newspaper } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatInfoTime, infoDisplayTitle } from "@/components/lib/format"
import { openExternal } from "@/components/lib/safe-url"
import { analysisLink } from "../columns"
import { RelatedInfo } from "../model"

/**
 * 全面报道: 与当前信息「描述同一件事」的其它来源报道列表。
 * 数据来自后端 (经 ServerPort) `/info/analysis` (已按相关度排序),
 * 这里只负责把每个来源渲染成一行: 发布者 + 标题 + 时间 + 关联强度 (共享实体数),
 * 标题跳原文, 末尾可进该来源的关联分析。
 */
export default function CoverageList({ items }: { items: RelatedInfo[] }) {
  if (!items.length) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Newspaper className="h-5 w-5" />
        暂无同一事件的其他报道
      </div>
    )
  }

  return (
    <ul className="divide-y">
      {items.map((info) => (
        <li key={info.url} className="flex flex-col gap-1 py-3 first:pt-0">
          <div className="flex items-start justify-between gap-2">
            <Button
              variant="link"
              className="h-auto min-w-0 justify-start whitespace-normal break-all p-0 text-left text-sm font-medium"
              onClick={() => openExternal(info.url)}
            >
              {infoDisplayTitle(info.title) || info.url}
              <ExternalLink className="ml-1 inline h-3 w-3 shrink-0" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs text-muted-foreground"
              onClick={() => window.open(analysisLink(info.url), "_blank")}
            >
              全面报道
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">
              {info.publisher?.name || info.publisher?.domain || "未知来源"}
            </span>
            <span>{formatInfoTime(info)}</span>
            {/* 关联强度: 共享实体数解释「为什么相关」; 有词条的共享实体更可信, 合并到同一徽标里表述 */}
            {info.shared > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5">
                共享 {info.shared} 个实体
                {info.shared_entry > 0 ? ` · ${info.shared_entry} 个有词条` : ""}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
