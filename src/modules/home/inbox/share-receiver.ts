import { toast } from "sonner"
import type { NewBookmark } from "@protocol/files"
import { base64ToBytes, isBase64 } from "@/lib/base64"
import { recordFirstCreatedCapture } from "@/lib/capture-onboarding"
import { isTauri, takeNativeCaptureShares, type NativeCaptureSharePayload } from "@/lib/tauri"
import {
  createBookmarkFile,
  listBookmarkFiles,
} from "@/modules/home/bookmarks/bookmark-file-system"
import { INBOX_TARGET } from "@/shell/nav-config"
import { openTarget } from "@/workspace/store"
import { CAPTURE_INBOX_TAG } from "@/files/web-snapshot"
import {
  canonicalUrl,
  captureImportSummaryMessage,
  importCaptureFiles,
  type CaptureImportSummary,
} from "./capture-import"

const PENDING_EVENT = "capture-share://pending"
const MAX_ENCODED_FILE_BYTES = 44 * 1024 * 1024

export type CaptureShareReceiverDeps = Readonly<{
  listBookmarkUrls: () => Promise<readonly string[]>
  createBookmark: (input: NewBookmark) => Promise<void>
  importFiles: (files: readonly File[]) => Promise<CaptureImportSummary>
}>

const DEFAULT_DEPS: CaptureShareReceiverDeps = {
  async listBookmarkUrls() {
    const data = await listBookmarkFiles()
    return data.bookmarks.map((bookmark) => bookmark.url)
  },
  async createBookmark(input) {
    await createBookmarkFile(input, null)
  },
  importFiles(files) {
    return importCaptureFiles(files)
  },
}

type MutableCaptureImportSummary = {
  -readonly [Key in keyof CaptureImportSummary]: CaptureImportSummary[Key]
}

function emptySummary(): MutableCaptureImportSummary {
  return { bookmarksCreated: 0, resourcesCreated: 0, duplicates: 0, failed: 0, lastError: "" }
}

function externalHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return null
    url.username = ""
    url.password = ""
    return url.href
  } catch {
    return null
  }
}

function sharedFile(payload: Extract<NativeCaptureSharePayload, { kind: "file" }>): File {
  if (
    !payload.name.trim() ||
    payload.base64.length > MAX_ENCODED_FILE_BYTES ||
    !isBase64(payload.base64)
  ) {
    throw new Error(`${payload.name || "共享文件"}：文件载荷无效`)
  }
  return new File([base64ToBytes(payload.base64)], payload.name, { type: payload.mime })
}

/** 将原生分享批次写入既有 FileSystem 捕获链；单项失败不回滚已成功对象。 */
export async function importNativeCaptureShares(
  payloads: readonly NativeCaptureSharePayload[],
  deps: CaptureShareReceiverDeps = DEFAULT_DEPS,
): Promise<CaptureImportSummary> {
  const summary = emptySummary()
  const files: File[] = []
  let knownUrls: Set<string> | undefined

  for (const payload of payloads) {
    if (payload.kind === "error") {
      summary.failed++
      summary.lastError = `${payload.name}：${payload.message}`
      continue
    }
    if (payload.kind === "file") {
      try {
        files.push(sharedFile(payload))
      } catch (error) {
        summary.failed++
        summary.lastError = error instanceof Error ? error.message : String(error)
      }
      continue
    }

    const url = externalHttpUrl(payload.url)
    if (!url) {
      summary.failed++
      summary.lastError = "分享链接无效或不是 HTTP(S) 地址"
      continue
    }
    try {
      if (!knownUrls) {
        knownUrls = new Set((await deps.listBookmarkUrls()).map(canonicalUrl))
      }
      const canonical = canonicalUrl(url)
      if (knownUrls.has(canonical)) {
        summary.duplicates++
        continue
      }
      await deps.createBookmark({
        title: payload.title?.trim() || new URL(url).hostname,
        url,
        tags: [CAPTURE_INBOX_TAG],
      })
      knownUrls.add(canonical)
      summary.bookmarksCreated++
    } catch (error) {
      summary.failed++
      summary.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  if (files.length > 0) {
    try {
      const imported = await deps.importFiles(files)
      summary.bookmarksCreated += imported.bookmarksCreated
      summary.resourcesCreated += imported.resourcesCreated
      summary.duplicates += imported.duplicates
      summary.failed += imported.failed
      if (imported.lastError) summary.lastError = imported.lastError
    } catch (error) {
      summary.failed += files.length
      summary.lastError = error instanceof Error ? error.message : String(error)
    }
  }
  if (summary.bookmarksCreated + summary.resourcesCreated > 0) recordFirstCreatedCapture()
  return summary
}

let installed = false
let draining = false
let drainAgain = false

async function drainNativeShares(): Promise<void> {
  if (draining) {
    drainAgain = true
    return
  }
  draining = true
  try {
    do {
      drainAgain = false
      const payloads = await takeNativeCaptureShares()
      if (payloads.length === 0) continue
      const summary = await importNativeCaptureShares(payloads)
      const message = captureImportSummaryMessage(summary)
      if (summary.failed) {
        toast.warning("系统投递已部分处理", { description: `${message}。${summary.lastError}` })
      } else {
        toast.success("已投递到收件箱", { description: message })
      }
      openTarget(INBOX_TARGET)
    } while (drainAgain)
  } catch (error) {
    toast.error("系统投递处理失败", {
      description: error instanceof Error ? error.message : String(error),
    })
  } finally {
    draining = false
    if (drainAgain) void drainNativeShares()
  }
}

/** 安装原生系统分享接收器；先监听再排空冷启动队列，闭合启动竞态。 */
export async function installCaptureShareReceiver(): Promise<void> {
  if (installed || !isTauri()) return
  installed = true
  const { listen } = await import("@tauri-apps/api/event")
  await listen(PENDING_EVENT, () => void drainNativeShares())
  await drainNativeShares()
}
