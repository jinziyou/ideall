import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildWebExcerptDocument,
  buildWebSnapshotDocument,
  WEB_EXCERPT_TEXT_LIMIT,
  WEB_SNAPSHOT_TEXT_LIMIT,
  webExcerptTextFromText,
  webSnapshotMetadata,
  webSnapshotSourceFromText,
} from "./web-snapshot"

const CAPTURED_AT = Date.parse("2026-07-16T08:30:00.000Z")

test("web snapshot: builds editable note blocks with source metadata", () => {
  const snapshot = buildWebSnapshotDocument({
    url: "https://example.com/article#part",
    text: " First paragraph.\r\n\r\n Second   paragraph. ",
    capturedAt: CAPTURED_AT,
  })

  assert.equal(snapshot.sourceUrl, "https://example.com/article#part")
  assert.equal(snapshot.bodyCharacters, 33)
  assert.equal(snapshot.truncated, false)
  assert.deepEqual(webSnapshotMetadata(snapshot.content), {
    sourceUrl: "https://example.com/article#part",
    capturedAt: CAPTURED_AT,
  })
})

test("web snapshot: bounds oversized page text and marks truncation", () => {
  const snapshot = buildWebSnapshotDocument({
    url: "https://example.com/large",
    text: "a".repeat(WEB_SNAPSHOT_TEXT_LIMIT + 10),
    capturedAt: CAPTURED_AT,
  })

  assert.equal(snapshot.bodyCharacters, WEB_SNAPSHOT_TEXT_LIMIT)
  assert.equal(snapshot.truncated, true)
  assert.match(JSON.stringify(snapshot.content), /存储上限截断/)
})

test("web snapshot: emits a readable placeholder for pages without text", () => {
  const snapshot = buildWebSnapshotDocument({
    url: "https://example.com/empty",
    text: "   ",
    capturedAt: CAPTURED_AT,
  })

  assert.equal(snapshot.bodyCharacters, 0)
  assert.match(JSON.stringify(snapshot.content), /未返回可读正文/)
})

test("web snapshot: only restores safe HTTP(S) sources", () => {
  assert.equal(
    webSnapshotSourceFromText("原始来源：https://example.com/a 捕获时间：later"),
    "https://example.com/a",
  )
  assert.equal(webSnapshotSourceFromText("原始来源：javascript:alert(1)"), null)
  assert.throws(
    () => buildWebSnapshotDocument({ url: "file:///tmp/private", text: "private" }),
    /HTTP\(S\)/,
  )
})

test("web excerpt: creates a blockquote and restores normalized selection text", () => {
  const excerpt = buildWebExcerptDocument({
    url: "https://example.com/article#finding",
    selection: "  Important\n\n finding.  ",
    capturedAt: CAPTURED_AT,
  })

  assert.equal(excerpt.excerpt, "Important finding.")
  assert.equal(excerpt.bodyCharacters, 18)
  assert.equal(excerpt.truncated, false)
  assert.match(JSON.stringify(excerpt.content), /blockquote/)
  assert.equal(
    webExcerptTextFromText("source metadata 摘录： Important finding."),
    "Important finding.",
  )
})

test("web excerpt: rejects empty selection and bounds oversized text", () => {
  assert.throws(
    () =>
      buildWebExcerptDocument({
        url: "https://example.com/article",
        selection: "   ",
        capturedAt: CAPTURED_AT,
      }),
    /选择/,
  )
  const excerpt = buildWebExcerptDocument({
    url: "https://example.com/article",
    selection: "a".repeat(WEB_EXCERPT_TEXT_LIMIT + 1),
    capturedAt: CAPTURED_AT,
  })
  assert.equal(excerpt.bodyCharacters, WEB_EXCERPT_TEXT_LIMIT)
  assert.equal(excerpt.truncated, true)
})
