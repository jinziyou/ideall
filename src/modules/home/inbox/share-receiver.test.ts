import assert from "node:assert/strict"
import { test } from "node:test"
import { bytesToBase64 } from "@/lib/base64"
import { importNativeCaptureShares, type CaptureShareReceiverDeps } from "./share-receiver"

test("system share receiver: deduplicates URLs and forwards validated files to the inbox importer", async () => {
  const bookmarks: Array<{ title: string; url: string; tags?: string[] }> = []
  const files: File[] = []
  const deps: CaptureShareReceiverDeps = {
    listBookmarkUrls: async () => ["https://example.com/saved#old"],
    createBookmark: async (input) => {
      bookmarks.push(input)
    },
    importFiles: async (input) => {
      files.push(...input)
      return {
        bookmarksCreated: 0,
        resourcesCreated: input.length,
        duplicates: 0,
        failed: 0,
        lastError: "",
      }
    },
  }

  const summary = await importNativeCaptureShares(
    [
      { kind: "url", url: "https://example.com/saved#new" },
      { kind: "url", url: "https://example.com/new", title: "Shared research" },
      {
        kind: "file",
        name: "paper.pdf",
        mime: "application/pdf",
        base64: bytesToBase64(new TextEncoder().encode("pdf")),
      },
      { kind: "error", name: "archive.zip", message: "仅支持 HTML、PDF 和图片" },
    ],
    deps,
  )

  assert.deepEqual(bookmarks, [
    {
      title: "Shared research",
      url: "https://example.com/new",
      tags: ["收件箱"],
    },
  ])
  assert.equal(files[0]?.name, "paper.pdf")
  assert.deepEqual(summary, {
    bookmarksCreated: 1,
    resourcesCreated: 1,
    duplicates: 1,
    failed: 1,
    lastError: "archive.zip：仅支持 HTML、PDF 和图片",
  })
})

test("system share receiver: rejects non-http URLs and malformed file payloads", async () => {
  const deps: CaptureShareReceiverDeps = {
    listBookmarkUrls: async () => [],
    createBookmark: async () => assert.fail("invalid URLs must not be persisted"),
    importFiles: async () => assert.fail("invalid files must not be imported"),
  }

  const summary = await importNativeCaptureShares(
    [
      { kind: "url", url: "javascript:alert(1)" },
      { kind: "file", name: "paper.pdf", mime: "application/pdf", base64: "not-base64" },
    ],
    deps,
  )

  assert.equal(summary.failed, 2)
  assert.match(summary.lastError, /文件载荷无效/)
})
