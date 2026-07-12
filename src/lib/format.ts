// 跨模块通用展示格式化工具 (时间 / 字节) —— home、agent、shell、workspace 共用。
export { fileTypeInfo, fileExtension } from "./file-type"
export type { FileKind, FilePreviewKind, FileTypeInfo, FileTypeTone } from "./file-type"

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

/** 相对/绝对时间, 例如 "3 分钟前" / "2026-05-30" */
export function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return "刚刚"
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 人类可读的字节大小 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 将秒数格式化为音视频控件使用的 mm:ss。 */
export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00"
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
}
