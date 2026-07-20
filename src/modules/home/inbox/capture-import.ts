import type { NewBookmark } from "@protocol/files"
import { parseBookmarksHtml, type ParsedBookmark } from "@/files/bookmark-import"
import { CAPTURE_INBOX_TAG } from "@/files/web-snapshot"
import { recordFirstCreatedCapture } from "@/lib/capture-onboarding"
import {
  createBookmarkFile,
  createBookmarkFolder,
  listBookmarkFiles,
  type FileBookmarkFolder,
} from "@/modules/home/bookmarks/bookmark-file-system"
import { saveUploadedFile } from "@/modules/home/resources/file-upload"

export type CaptureImportFileKind = "bookmarks-html" | "resource-html" | "pdf" | "image"

export type CaptureImportSummary = Readonly<{
  bookmarksCreated: number
  resourcesCreated: number
  duplicates: number
  failed: number
  lastError: string
}>

type CaptureImportFolder = Readonly<{ id: string; name: string }>

export type CaptureImportDeps = Readonly<{
  parseBookmarks: (html: string) => ParsedBookmark[]
  listBookmarks: () => Promise<{
    folders: CaptureImportFolder[]
    bookmarks: readonly Readonly<{ url: string }>[]
  }>
  createFolder: (name: string) => Promise<CaptureImportFolder>
  createBookmark: (input: NewBookmark, folder: CaptureImportFolder | null) => Promise<void>
  saveResource: (file: File, tags: readonly string[]) => Promise<unknown>
}>

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
])

function extension(name: string): string {
  const index = name.lastIndexOf(".")
  return index < 0 ? "" : name.slice(index + 1).toLowerCase()
}

export function captureImportFileKind(
  file: Pick<File, "name" | "type">,
): CaptureImportFileKind | null {
  const ext = extension(file.name)
  const mime = file.type.toLowerCase()
  if (mime === "text/html" || ext === "html" || ext === "htm") return "bookmarks-html"
  if (mime === "application/pdf" || ext === "pdf") return "pdf"
  if (mime.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) return "image"
  return null
}

export function canonicalUrl(raw: string): string {
  const trimmed = raw.trim()
  try {
    const url = new URL(trimmed)
    url.hash = ""
    return url.href
  } catch {
    return trimmed
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const DEFAULT_DEPS: CaptureImportDeps = {
  parseBookmarks: parseBookmarksHtml,
  async listBookmarks() {
    return listBookmarkFiles()
  },
  createFolder: createBookmarkFolder,
  createBookmark(input, folder) {
    return createBookmarkFile(input, folder as FileBookmarkFolder | null)
  },
  saveResource: saveUploadedFile,
}

/**
 * 统一导入入口：书签导出 HTML 展开为书签；普通 HTML、PDF 与图片保留原文件。
 * 每个对象独立失败，成功项不会因后续错误回滚。
 */
export async function importCaptureFiles(
  input: FileList | readonly File[],
  deps: CaptureImportDeps = DEFAULT_DEPS,
): Promise<CaptureImportSummary> {
  let bookmarksCreated = 0
  let resourcesCreated = 0
  let duplicates = 0
  let failed = 0
  let lastError = ""
  let bookmarkLibrary:
    | {
        folders: Map<string, CaptureImportFolder>
        urls: Set<string>
      }
    | undefined

  async function ensureBookmarkLibrary() {
    if (bookmarkLibrary) return bookmarkLibrary
    const current = await deps.listBookmarks()
    bookmarkLibrary = {
      folders: new Map(current.folders.map((folder) => [folder.name, folder])),
      urls: new Set(current.bookmarks.map((bookmark) => canonicalUrl(bookmark.url))),
    }
    return bookmarkLibrary
  }

  async function saveResource(file: File) {
    await deps.saveResource(file, [CAPTURE_INBOX_TAG])
    resourcesCreated++
  }

  for (const file of Array.from(input)) {
    const kind = captureImportFileKind(file)
    if (!kind) {
      failed++
      lastError = `${file.name}：仅支持 HTML、PDF 和图片`
      continue
    }
    try {
      if (kind !== "bookmarks-html") {
        await saveResource(file)
        continue
      }
      const parsed = deps.parseBookmarks(await file.text())
      if (parsed.length === 0) {
        await saveResource(file)
        continue
      }
      const library = await ensureBookmarkLibrary()
      for (const bookmark of parsed) {
        const canonical = canonicalUrl(bookmark.url)
        if (library.urls.has(canonical)) {
          duplicates++
          continue
        }
        try {
          const folderName = bookmark.folderPath.join(" / ")
          let folder: CaptureImportFolder | null = null
          if (folderName) {
            folder = library.folders.get(folderName) ?? null
            if (!folder) {
              folder = await deps.createFolder(folderName)
              library.folders.set(folderName, folder)
            }
          }
          await deps.createBookmark(
            {
              title: bookmark.title,
              url: bookmark.url,
              favicon: bookmark.favicon,
              tags: [CAPTURE_INBOX_TAG],
            },
            folder,
          )
          library.urls.add(canonical)
          bookmarksCreated++
        } catch (error) {
          failed++
          lastError = `${bookmark.title || bookmark.url}：${errorMessage(error)}`
        }
      }
    } catch (error) {
      failed++
      lastError = `${file.name}：${errorMessage(error)}`
    }
  }

  if (bookmarksCreated + resourcesCreated > 0) recordFirstCreatedCapture()
  return { bookmarksCreated, resourcesCreated, duplicates, failed, lastError }
}

export function captureImportSummaryMessage(summary: CaptureImportSummary): string {
  const parts: string[] = []
  if (summary.bookmarksCreated) parts.push(`${summary.bookmarksCreated} 个书签`)
  if (summary.resourcesCreated) parts.push(`${summary.resourcesCreated} 个文件`)
  if (summary.duplicates) parts.push(`跳过 ${summary.duplicates} 个重复项`)
  if (summary.failed) parts.push(`${summary.failed} 个失败`)
  return parts.length > 0 ? parts.join("，") : "没有可导入的内容"
}
