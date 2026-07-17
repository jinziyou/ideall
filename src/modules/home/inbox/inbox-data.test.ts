import assert from "node:assert/strict"
import { test } from "node:test"
import { buildCaptureInboxItems, withoutCaptureInboxTag } from "./inbox-data"

test("capture inbox: projects tagged bookmarks and notes in newest-first order", () => {
  const items = buildCaptureInboxItems(
    [
      {
        id: "bookmark-1",
        title: "Saved link",
        url: "https://example.com/link",
        description: "Bookmark description",
        tags: ["收件箱"],
        createdAt: 20,
      },
      {
        id: "bookmark-archived",
        title: "Archived",
        url: "https://example.com/archived",
        description: "",
        tags: [],
        createdAt: 50,
      },
    ],
    [
      {
        id: "note-1",
        title: "Finding · 摘录",
        search:
          "原始来源：https://example.com/research 捕获时间：2026-07-16T00:00:00Z 摘录： Selected finding",
        tags: ["网页摘录", "收件箱"],
        createdAt: 30,
        updatedAt: 31,
      },
    ],
    [
      {
        id: "file-1",
        name: "paper.pdf",
        type: "application/pdf",
        tags: ["收件箱"],
        createdAt: 40,
      },
    ],
  )

  assert.deepEqual(
    items.map(({ id, captureType, summary, sourceUrl }) => ({
      id,
      captureType,
      summary,
      sourceUrl,
    })),
    [
      {
        id: "file-1",
        captureType: "PDF",
        summary: "application/pdf",
        sourceUrl: null,
      },
      {
        id: "note-1",
        captureType: "网页摘录",
        summary: "Selected finding",
        sourceUrl: "https://example.com/research",
      },
      {
        id: "bookmark-1",
        captureType: "书签",
        summary: "Bookmark description",
        sourceUrl: "https://example.com/link",
      },
    ],
  )
})

test("capture inbox: archive removes only the inbox tag", () => {
  assert.deepEqual(withoutCaptureInboxTag(["网页快照", "收件箱", "离线"]), ["网页快照", "离线"])
})
