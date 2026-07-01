// 聚合搜索跳转的唯一数据来源: 把搜索引擎模板里的 {q} 占位替换为已编码关键词, 经 openExternal
// 打开 (App 走系统浏览器, web 走新标签)。供侧栏「聚合搜索」与工具页 QuickJump 复用, 避免各处手抄
// `window.open(queryUrl.replace(...))` 漂移 (此前侧栏用裸 window.open, 桌面 App 下不经系统浏览器)。

import { openExternal } from "@/lib/safe-url"

/**
 * 用关键词跳转到某搜索引擎的结果页 (link-out)。
 * @param queryUrl 带 `{q}` 占位的查询模板 (来自 SEARCH_ENGINES 的 queryUrl)
 * @param term     用户输入的关键词 (未编码; 调用方应已 trim 且非空)
 */
export function jumpToSearchEngine(queryUrl: string, term: string): void {
  openExternal(queryUrl.replace("{q}", encodeURIComponent(term)))
}
