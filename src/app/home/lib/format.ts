// Home 模块通用展示格式化工具。

/** 人类可读的字节大小 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
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

export type FileKind = "image" | "video" | "audio" | "pdf" | "text" | "archive" | "other"

/** 按 MIME / 扩展名归类文件, 决定预览方式与图标 */
export function fileKind(name: string, type: string): FileKind {
  const mime = type.toLowerCase()
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  if (mime === "application/pdf" || ext === "pdf") return "pdf"
  if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("javascript") ||
    [
      "txt",
      "md",
      "json",
      "csv",
      "log",
      "xml",
      "yml",
      "yaml",
      "js",
      "ts",
      "tsx",
      "jsx",
      "css",
      "html",
      "py",
      "rs",
      "go",
      "sh",
    ].includes(ext)
  )
    return "text"
  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext)) return "archive"
  return "other"
}
