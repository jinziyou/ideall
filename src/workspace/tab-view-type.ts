// 标签视图类型 —— 标签栏按「概览 / 面板 / 配置 / 内容」分类展示。
// 由 tab.kind (+ params) 推导, 不持久化; 驱动 tab-bar 左侧类型徽标。

import type { Tab } from "./types"

export type TabViewType = "overview" | "panel" | "config" | "content"

export const TAB_VIEW_LABEL: Record<TabViewType, string> = {
  overview: "概览",
  panel: "面板",
  config: "配置",
  content: "内容",
}

const CONFIG_KINDS = new Set([
  "ai-settings",
  "home-settings",
  "ai-mcp",
  "ai-skills",
  "ai-rules",
  "ai-tasks",
])

/** 由已打开标签推导视图类型 (概览 / 面板 / 配置 / 内容)。 */
export function tabViewType(tab: Tab): TabViewType {
  if (tab.kind === "home-overview") return "overview"
  if (tab.kind === "node" || tab.kind === "browser-view") return "content"
  if (CONFIG_KINDS.has(tab.kind)) return "config"
  return "panel"
}
