import { fileRefKey, type FileRef } from "@protocol/file-system"

/**
 * 缩略图缓存（Thumbnail spec 的形状，docs/freedesktop-alignment.md §6 S5b）。
 *
 * 借 spec 的「缓存 key = 身份 + 失效版本」形状，但 **不借其 file:// URI + mtime**：
 * key = `(FileRef, version)`——FileRef 是 ideall 的文件身份，version 是 provider 的
 * 内容版本（CAS/时间戳），内容变化必推进版本，缓存不会读到陈旧图。
 *
 * 归 `cache` 语义：纯内存 LRU（会话级、可重建），不进持久层、不进同步、不进归档。
 * dataURL 值免 ObjectURL 生命周期管理（无泄漏面，GC 回收）。
 */

export const THUMBNAIL_MAX_ENTRIES = 200
export const THUMBNAIL_MAX_DIMENSION = 320

export type ThumbnailLoader = () => Promise<Blob | null>
export type ThumbnailDecoder = (blob: Blob, maxDimension: number) => Promise<string | null>

/** createImageBitmap + canvas 降采样 → dataURL；失败返回 null（调用方回退原图路径）。 */
export async function defaultThumbnailDecoder(
  blob: Blob,
  maxDimension: number,
): Promise<string | null> {
  // 动图降采样丢失动画，且 GIF 经 JPEG 会把透明区域合成黑色——返回 null 让调用方走原图回退。
  if (blob.type === "image/gif") return null
  try {
    const bitmap = await createImageBitmap(blob)
    try {
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height, 1))
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")
      if (!context) return null
      context.drawImage(bitmap, 0, 0, width, height)
      // 统一 PNG 输出：保留 alpha（AVIF/ICO/TIFF 等带透明通道的格式不会被 JPEG 黑底化）。
      return canvas.toDataURL("image/png")
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

const entries = new Map<string, Promise<string | null>>()

export function thumbnailCacheKey(ref: FileRef, version: string | null): string {
  return `${fileRefKey(ref)}|${version ?? "null"}`
}

export function thumbnailCacheSize(): number {
  return entries.size
}

export function clearThumbnailCache(): void {
  entries.clear()
}

/**
 * 取缩略图（降采样 dataURL）：命中/在途去重直接复用，未命中经 load + decode 构建。
 * 失败（读取/解码）返回 null 且**不缓存**（下次重试）；内容版本变化自然命中新 key。
 */
export function getThumbnail(
  ref: FileRef,
  version: string | null,
  load: ThumbnailLoader,
  decode: ThumbnailDecoder = defaultThumbnailDecoder,
): Promise<string | null> {
  const key = thumbnailCacheKey(ref, version)
  const cached = entries.get(key)
  if (cached) {
    // LRU touch：命中后移至最新。
    entries.delete(key)
    entries.set(key, cached)
    return cached
  }
  const pending = (async () => {
    try {
      const blob = await load()
      if (!blob) return null
      return await decode(blob, THUMBNAIL_MAX_DIMENSION)
    } catch {
      return null
    }
  })()
  entries.set(key, pending)
  // 失败结果不占缓存（瞬时错误可重试）。
  void pending.then((result) => {
    if (result === null && entries.get(key) === pending) entries.delete(key)
  })
  if (entries.size > THUMBNAIL_MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest !== undefined) entries.delete(oldest)
  }
  return pending
}
