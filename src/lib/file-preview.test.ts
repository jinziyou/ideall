import assert from "node:assert/strict"
import { test } from "node:test"
import { TEXT_PREVIEW_LIMIT, textPreviewRange } from "./file-preview"

test("file preview: only known oversized read-only text uses a bounded range", () => {
  assert.deepEqual(textPreviewRange(true, TEXT_PREVIEW_LIMIT + 1), {
    start: 0,
    end: TEXT_PREVIEW_LIMIT,
  })
  assert.equal(textPreviewRange(true, TEXT_PREVIEW_LIMIT), undefined)
  assert.equal(textPreviewRange(true, undefined), undefined)
  assert.equal(textPreviewRange(false, TEXT_PREVIEW_LIMIT + 1), undefined)
})
