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
