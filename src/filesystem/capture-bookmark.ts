import type { FileRef } from "@protocol/file-system"
import {
  CAPTURE_BOOKMARK_ACTION,
  type CaptureBookmarkInput,
  type CaptureBookmarkResult,
} from "@protocol/capture"
import type { Bookmark } from "@protocol/files"
import { canonicalHttpUrl } from "@/lib/canonical-http-url"
import { recordFirstCreatedCapture } from "@/lib/capture-onboarding"
import { corePlaceRef } from "./resource-file-system/catalog"
import { invokeFileAction } from "./registry"
import type { FileSystemAccessContext } from "./types"

const BOOKMARKS_ROOT = corePlaceRef("bookmarks")
const UI_CAPTURE_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "action",
} as const satisfies FileSystemAccessContext

export type CaptureBookmarkInvoker = (
  ref: FileRef,
  action: string,
  input: unknown,
  ctx: FileSystemAccessContext,
) => Promise<unknown>

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function decodeBookmark(value: unknown): Bookmark | null {
  const raw = record(value)
  if (
    !raw ||
    typeof raw.id !== "string" ||
    !raw.id ||
    typeof raw.title !== "string" ||
    typeof raw.url !== "string" ||
    !canonicalHttpUrl(raw.url) ||
    typeof raw.description !== "string" ||
    typeof raw.favicon !== "string" ||
    (raw.folderId !== null && typeof raw.folderId !== "string") ||
    !Array.isArray(raw.tags) ||
    !raw.tags.every((tag) => typeof tag === "string") ||
    typeof raw.createdAt !== "number" ||
    !Number.isFinite(raw.createdAt)
  ) {
    return null
  }
  return raw as unknown as Bookmark
}

export function decodeCaptureBookmarkResult(value: unknown): CaptureBookmarkResult {
  const raw = record(value)
  const bookmark = decodeBookmark(raw?.bookmark)
  if (!raw || (raw.status !== "created" && raw.status !== "existing") || !bookmark) {
    throw new Error("FileSystem 返回了无效的捕获回执")
  }
  return { status: raw.status, bookmark }
}

/** 新闻、社区、浏览器与普通外链统一经过 bookmarks FileSystem specialized action。 */
export async function captureBookmarkToMine(
  input: CaptureBookmarkInput,
  ctx: FileSystemAccessContext = UI_CAPTURE_CONTEXT,
  invoke: CaptureBookmarkInvoker = invokeFileAction,
): Promise<CaptureBookmarkResult> {
  const result = await invoke(BOOKMARKS_ROOT, CAPTURE_BOOKMARK_ACTION, input, ctx)
  const decoded = decodeCaptureBookmarkResult(result)
  if (decoded.status === "created") recordFirstCreatedCapture()
  return decoded
}
