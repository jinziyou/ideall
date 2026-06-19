// 订阅类型 → spoke 视觉映射的单一真相源 (home 渲染订阅项专用; app→protocol 合法依赖)。
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
    actionLabel: "订阅发布者",
  },
  entity: {
    dotClass: "bg-spoke-info",
    topBorderClass: "border-t-spoke-info",
    actionLabel: "订阅实体",
  },
  search: {
    dotClass: "bg-spoke-info",
    topBorderClass: "border-t-spoke-info",
    actionLabel: "订阅搜索",
  },
  peer: {
    dotClass: "bg-spoke-community",
    topBorderClass: "border-t-spoke-community",
    actionLabel: "订阅社区发布者",
  },
  tool: {
    dotClass: "bg-spoke-tool",
    topBorderClass: "border-t-spoke-tool",
    actionLabel: "钉住工具",
  },
}
