import { addFile } from "@/files/stores/files-store"

export type SaveFileFn = (file: File) => Promise<unknown>

export type FileUploadSummary = {
  ok: number
  failed: number
  lastError: string
}

export type FileUploadFeedback =
  | { kind: "none" }
  | { kind: "success"; message: string }
  | { kind: "warning"; message: string; description: string }
  | { kind: "error"; message: string; description: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function saveUploadedFiles(
  fileList: FileList | File[],
  saveFile: SaveFileFn = addFile,
): Promise<FileUploadSummary> {
  let ok = 0
  let failed = 0
  let lastError = ""

  for (const file of Array.from(fileList)) {
    try {
      await saveFile(file)
      ok++
    } catch (error) {
      failed++
      lastError = errorMessage(error)
    }
  }

  return { ok, failed, lastError }
}

export function fileUploadFeedback(summary: FileUploadSummary): FileUploadFeedback {
  if (summary.ok && summary.failed) {
    return {
      kind: "warning",
      message: `已添加 ${summary.ok} 个，${summary.failed} 个失败（可能是本机存储已满）`,
      description: summary.lastError,
    }
  }

  if (summary.failed) {
    return {
      kind: "error",
      message: "保存文件失败",
      description: summary.lastError,
    }
  }

  if (summary.ok) {
    return { kind: "success", message: `已添加 ${summary.ok} 个文件` }
  }

  return { kind: "none" }
}
