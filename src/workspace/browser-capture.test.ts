import assert from "node:assert/strict"
import { test } from "node:test"
import type { NewNote } from "@protocol/files"
import type { CaptureBookmarkInput } from "@protocol/capture"
import {
  browserCaptureDescription,
  captureCurrentBrowserExcerpt,
  captureCurrentBrowserPage,
  captureCurrentBrowserSnapshot,
  type BrowserCaptureDeps,
  type BrowserSnapshotDeps,
} from "./browser-capture"

function deps(overrides: Partial<BrowserCaptureDeps> = {}) {
  const created: CaptureBookmarkInput[] = []
  const value: BrowserCaptureDeps = {
    getPageContent: async () => ({
      url: "https://example.com/research#section",
      title: "Research page",
      text: "  First paragraph.\n\nSecond   paragraph.  ",
      selection: "Selected finding",
    }),
    captureBookmark: async (input) => {
      created.push(input)
      return {
        status: "created",
        bookmark: {
          id: "bm-1",
          title: input.title,
          url: input.url,
          description: input.description ?? "",
          favicon: input.favicon ?? "",
          folderId: null,
          tags: ["收件箱"],
          createdAt: 1,
        },
      }
    },
    ...overrides,
  }
  return { value, created }
}

test("browser capture: creates a bookmark with normalized page summary", async () => {
  const fixture = deps()
  const result = await captureCurrentBrowserPage(fixture.value)

  assert.equal(result.status, "created")
  assert.deepEqual(fixture.created, [
    {
      title: "Research page",
      url: "https://example.com/research#section",
      description: "First paragraph. Second paragraph.",
    },
  ])
})

test("browser capture: treats fragment variants as one bookmark", async () => {
  const fixture = deps({
    captureBookmark: async () => ({
      status: "existing",
      bookmark: {
        id: "bm-old",
        title: "Saved research",
        url: "https://example.com/research#other",
        description: "Saved before",
        favicon: "",
        folderId: null,
        tags: [],
        createdAt: 1,
      },
    }),
  })
  const result = await captureCurrentBrowserPage(fixture.value)

  assert.equal(result.status, "existing")
  assert.equal(result.title, "Saved research")
  assert.deepEqual(fixture.created, [])
})

test("browser capture: rejects non-http page URLs before writing", async () => {
  const fixture = deps({
    getPageContent: async () => ({
      url: "javascript:alert(1)",
      title: "Bad",
      text: "Bad",
      selection: "Bad",
    }),
  })

  await assert.rejects(() => captureCurrentBrowserPage(fixture.value), /HTTP\(S\)/)
  assert.deepEqual(fixture.created, [])
})

test("browser capture: falls back to hostname and bounds the summary", async () => {
  const fixture = deps({
    getPageContent: async () => ({
      url: "https://www.example.com/",
      title: " ",
      text: "abcdefghij",
      selection: "",
    }),
  })
  const result = await captureCurrentBrowserPage(fixture.value)

  assert.equal(result.title, "example.com")
  assert.equal(browserCaptureDescription("abcdefghij", 6), "abcde…")
})

function snapshotDeps(overrides: Partial<BrowserSnapshotDeps> = {}) {
  const created: Pick<NewNote, "title" | "content" | "tags">[] = []
  const value: BrowserSnapshotDeps = {
    getPageContent: async () => ({
      url: "https://example.com/research#section",
      title: "Research page",
      text: "First paragraph.\n\nSecond paragraph.",
      selection: "Selected finding",
    }),
    listNotes: async () => [],
    createNote: async (input) => {
      created.push(input)
    },
    now: () => Date.parse("2026-07-16T08:30:00.000Z"),
    ...overrides,
  }
  return { value, created }
}

test("browser capture: creates a searchable offline snapshot note", async () => {
  const fixture = snapshotDeps()
  const result = await captureCurrentBrowserSnapshot(fixture.value)

  assert.equal(result.status, "created")
  assert.equal(result.bodyCharacters, 33)
  assert.equal(result.truncated, false)
  assert.equal(fixture.created.length, 1)
  assert.equal(fixture.created[0]!.title, "Research page")
  assert.deepEqual(fixture.created[0]!.tags, ["网页快照", "离线", "收件箱"])
  assert.match(JSON.stringify(fixture.created[0]!.content), /First paragraph/)
  assert.match(
    JSON.stringify(fixture.created[0]!.content),
    /https:\/\/example.com\/research#section/,
  )
})

test("browser capture: deduplicates snapshot fragment variants by source URL", async () => {
  const fixture = snapshotDeps({
    listNotes: async () => [
      {
        title: "Saved snapshot",
        tags: ["网页快照", "离线"],
        search: "原始来源：https://example.com/research#other 捕获时间：2026-07-15T00:00:00Z",
      },
    ],
  })
  const result = await captureCurrentBrowserSnapshot(fixture.value)

  assert.equal(result.status, "existing")
  assert.equal(result.title, "Saved snapshot")
  assert.deepEqual(fixture.created, [])
})

test("browser capture: creates a sourced excerpt from the current selection", async () => {
  const fixture = snapshotDeps()
  const result = await captureCurrentBrowserExcerpt(fixture.value)

  assert.equal(result.status, "created")
  assert.equal(result.title, "Research page · 摘录")
  assert.equal(result.excerpt, "Selected finding")
  assert.equal(fixture.created.length, 1)
  assert.deepEqual(fixture.created[0]!.tags, ["网页摘录", "收件箱"])
  assert.match(JSON.stringify(fixture.created[0]!.content), /Selected finding/)
  assert.match(
    JSON.stringify(fixture.created[0]!.content),
    /https:\/\/example.com\/research#section/,
  )
})

test("browser capture: rejects an empty selection before writing an excerpt", async () => {
  const fixture = snapshotDeps({
    getPageContent: async () => ({
      url: "https://example.com/research",
      title: "Research page",
      text: "Page body",
      selection: "  ",
    }),
  })

  await assert.rejects(() => captureCurrentBrowserExcerpt(fixture.value), /选择/)
  assert.deepEqual(fixture.created, [])
})

test("browser capture: deduplicates only the same excerpt from the same source", async () => {
  const fixture = snapshotDeps({
    listNotes: async () => [
      {
        title: "Saved excerpt",
        tags: ["网页摘录", "收件箱"],
        search:
          "原始来源：https://example.com/research#other 捕获时间：2026-07-15T00:00:00Z 摘录： Selected finding",
      },
    ],
  })
  const result = await captureCurrentBrowserExcerpt(fixture.value)

  assert.equal(result.status, "existing")
  assert.equal(result.title, "Saved excerpt")
  assert.deepEqual(fixture.created, [])
})
