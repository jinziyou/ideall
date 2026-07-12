import type { FileReadResult } from "./types"
import { base64ToBytes } from "@/lib/base64"

/** 将 provider 的任一二进制表示规范化为可预览、下载的 Blob。 */
export function fileReadResultToBlob(result: FileReadResult): Blob {
  const { data } = result
  if (data instanceof Blob) return data
  if (typeof data === "string") return new Blob([data], { type: result.mediaType })
  if (data instanceof ArrayBuffer) return new Blob([data], { type: result.mediaType })
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
    return new Blob([bytes], { type: result.mediaType })
  }
  if (data && typeof data === "object" && "base64" in data && typeof data.base64 === "string") {
    return new Blob([base64ToBytes(data.base64)], { type: result.mediaType })
  }
  throw new TypeError("FileSystem read result is not byte-addressable")
}
