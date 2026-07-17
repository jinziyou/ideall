import assert from "node:assert/strict"
import { test } from "node:test"
import type { ParsedBookmark } from "@/files/bookmark-import"
import {
  captureImportFileKind,
  captureImportSummaryMessage,
  importCaptureFiles,
  type CaptureImportDeps,
} from "./capture-import"

function file(name: string, type: string, content = "content"): File {
  return new File([content], name, { type })
}

function fixture(parsed: ParsedBookmark[] = []) {
  const folders: string[] = []
  const bookmarks: Array<{ title: string; url: string; tags?: string[]; folder: string | null }> =
    []
  const resources: Array<{ name: string; tags: readonly string[] }> = []
  const deps: CaptureImportDeps = {
    parseBookmarks: () => parsed,
    listBookmarks: async () => ({
      folders: [{ id: "existing-folder", name: "Existing" }],
      bookmarks: [{ url: "https://example.com/saved#old" }],
    }),
    createFolder: async (name) => {
      folders.push(name)
      return { id: `folder-${folders.length}`, name }
    },
    createBookmark: async (input, folder) => {
      bookmarks.push({ ...input, folder: folder?.name ?? null })
    },
    saveResource: async (input, tags) => {
      resources.push({ name: input.name, tags })
    },
  }
  return { deps, folders, bookmarks, resources }
}

test("capture import: imports bookmark HTML with folders, tags and canonical deduplication", async () => {
  const fixtureData = fixture([
    {
      title: "Already saved",
      url: "https://example.com/saved#new",
      folderPath: [],
    },
    {
      title: "New research",
      url: "https://example.com/research",
      favicon: "https://example.com/favicon.ico",
      folderPath: ["Work", "Research"],
    },
  ])
  const summary = await importCaptureFiles(
    [file("bookmarks.html", "text/html", "<html></html>")],
    fixtureData.deps,
  )

  assert.deepEqual(summary, {
    bookmarksCreated: 1,
    resourcesCreated: 0,
    duplicates: 1,
    failed: 0,
    lastError: "",
  })
  assert.deepEqual(fixtureData.folders, ["Work / Research"])
  assert.deepEqual(fixtureData.bookmarks, [
    {
      title: "New research",
      url: "https://example.com/research",
      favicon: "https://example.com/favicon.ico",
      tags: ["收件箱"],
      folder: "Work / Research",
    },
  ])
})

test("capture import: stores ordinary HTML, PDF and images as tagged resources", async () => {
  const fixtureData = fixture([])
  const summary = await importCaptureFiles(
    [
      file("article.html", "text/html", "<article>Text</article>"),
      file("paper.pdf", "application/pdf"),
      file("scan.png", "image/png"),
      file("notes.txt", "text/plain"),
    ],
    fixtureData.deps,
  )

  assert.deepEqual(
    fixtureData.resources,
    ["article.html", "paper.pdf", "scan.png"].map((name) => ({ name, tags: ["收件箱"] })),
  )
  assert.equal(summary.resourcesCreated, 3)
  assert.equal(summary.failed, 1)
  assert.match(summary.lastError, /notes\.txt/)
  assert.equal(captureImportSummaryMessage(summary), "3 个文件，1 个失败")
})

test("capture import: recognizes supported formats by MIME or extension", () => {
  assert.equal(captureImportFileKind({ name: "export.htm", type: "" }), "bookmarks-html")
  assert.equal(captureImportFileKind({ name: "document", type: "application/pdf" }), "pdf")
  assert.equal(captureImportFileKind({ name: "photo.webp", type: "" }), "image")
  assert.equal(captureImportFileKind({ name: "archive.zip", type: "application/zip" }), null)
})
