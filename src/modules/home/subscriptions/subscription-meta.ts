// 关注类型 → home 关注项视觉映射的唯一数据来源。
// 注意: 类名必须保持完整静态字面量 (Tailwind 4 摇树), 禁止拼接。

import type { SubscriptionType } from "@protocol/subscription"

export type SpokeMeta = {
  dotClass: string
  topBorderClass: string
  actionLabel: string
}

export const SUB_SPOKE_META: Record<SubscriptionType, SpokeMeta> = {
  publisher: {
    dotClass: "bg-spoke-info",
    topBorderClass: "border-t-spoke-info",
    actionLabel: "关注发布者",
  },
  entity: {
    dotClass: "bg-spoke-info",
    topBorderClass: "border-t-spoke-info",
    actionLabel: "关注实体",
  },
  search: {
    dotClass: "bg-spoke-info",
    topBorderClass: "border-t-spoke-info",
    actionLabel: "关注搜索",
  },
  peer: {
    dotClass: "bg-spoke-community",
    topBorderClass: "border-t-spoke-community",
    actionLabel: "关注社区发布者",
  },
  tool: {
    dotClass: "bg-spoke-tool",
    topBorderClass: "border-t-spoke-tool",
    actionLabel: "固定工具",
  },
}
