/**
 * 把毫秒时间戳渲染为本地时间字符串 (zh-CN), 拿不到时回退占位符 "-"。
 *
 * 兼容 number / 数字字符串 / 空值。全站统一走本地时区 —— 不要再在各处手写
 * `new Date(ms).toLocaleString(...)`, 否则容易出现「同一条信息在不同页面显示不同时间」
 * (历史上 info 列表用本地时区、search 强制 UTC, 已统一到此)。
 */
export function formatTimestamp(ms: number | string | undefined | null): string {
  const n = typeof ms === "number" ? ms : parseInt(String(ms))
  if (!Number.isFinite(n) || n <= 0) return "-"
  return new Date(n).toLocaleString("zh-CN")
}

/** 信息展示时间: 优先发布时间, 缺失时回退收录时间 (部分源未抽到 publish_time)。 */
export function formatInfoTime(info: {
  publish_time?: number | string | null
  collect_time?: number | string | null
}): string {
  const pub =
    typeof info.publish_time === "number" ? info.publish_time : parseInt(String(info.publish_time))
  if (Number.isFinite(pub) && pub > 0) return formatTimestamp(pub)
  return formatTimestamp(info.collect_time)
}

/**
 * 清洗部分站点爬取时混入的 UI 噪声 (如第一财经标题末尾的阅读数 + 「N小时前」)。
 * 仅去掉末尾固定模式, 不动正文中间的换行。
 */
export function infoDisplayTitle(title: string | undefined | null): string {
  if (!title) return ""
  return title.replace(/\n+\d+\n+\d+(?:\.\d+)?(?:小时|分钟|天|秒|个月|年)前\s*$/, "").trim()
}
