// 标签视图类型 —— 标签栏按「概览 / 面板 / 配置 / 内容」分类展示。
// 由 tab.kind (+ params) 推导, 不持久化; 驱动 tab-bar 左侧类型徽标。

import type { Tab } from "./types"
import { tabDefinitionViewType, type TabViewType } from "./tab-definitions"
import { RESOURCE_TAB_KIND } from "./resource-tab"
import { FILE_ENGINE_TAB_KIND } from "./file-tab"

export type { TabViewType }

// 标签条 role=tab ↔ 内容区 role=tabpanel 的关联 id (无障碍: aria-controls / aria-labelledby)。
// tab.id 含 ":" "=" "&" 等字符, 经 encodeURIComponent 转成合法且唯一的 id 片段。
export const tabElId = (id: string) => `wstab-${encodeURIComponent(id)}`
export const tabPanelId = (id: string) => `wstabpanel-${encodeURIComponent(id)}`

export const TAB_VIEW_LABEL: Record<TabViewType, string> = {
  overview: "概览",
  panel: "面板",
  config: "配置",
  content: "内容",
}

/** 由已打开标签推导视图类型 (概览 / 面板 / 配置 / 内容)。 */
export function tabViewType(tab: Tab): TabViewType {
  if (
    tab.kind === FILE_ENGINE_TAB_KIND ||
    tab.kind === RESOURCE_TAB_KIND ||
    tab.kind === "node" ||
    tab.kind === "browser-view"
  ) {
    return "content"
  }
  return tabDefinitionViewType(tab.kind) ?? "panel"
}
