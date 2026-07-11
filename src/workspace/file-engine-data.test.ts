import assert from "node:assert/strict"
import { test } from "node:test"
import type { IdeallFile } from "@protocol/file-system"
import {
  acceptExternalTextDraft,
  createTextDraftDocument,
  editTextDraft,
  fileReadResultToBlob,
  fileTags,
  markTextDraftSaved,
  reconcileTextDraft,
} from "./file-engine-data"

const file: IdeallFile = {
  ref: { fileSystemId: "test", fileId: "file" },
  kind: "file",
  name: "demo.txt",
  mediaType: "text/plain",
  capabilities: ["read"],
  source: { kind: "local", id: "test" },
  properties: { tags: ["one", "two"] },
}

test("file engine data: tags are copied from validated file metadata", () => {
  const tags = fileTags(file)
  tags.push("local")
  assert.deepEqual(fileTags(file), ["one", "two"])
  assert.deepEqual(fileTags({ ...file, properties: { tags: ["ok", 1] } }), [])
})

test("file engine data: FileSystem base64 and binary reads become downloadable blobs", async () => {
  const fromBase64 = fileReadResultToBlob({
    data: { base64: "aGVsbG8=" },
    mediaType: "text/plain",
  })
  const fromBytes = fileReadResultToBlob({
    data: new Uint8Array([119, 111, 114, 108, 100]),
    mediaType: "text/plain",
  })

  assert.equal(fromBase64.type, "text/plain")
  assert.equal(await fromBase64.text(), "hello")
  assert.equal(await fromBytes.text(), "world")
  assert.throws(
    () => fileReadResultToBlob({ data: { nested: true }, mediaType: "application/json" }),
    TypeError,
  )
})

test("file engine data: clean drafts reload when an external version arrives", () => {
  const current = createTextDraftDocument({ fileKey: "fs:a", text: "old", version: "1" })

  assert.deepEqual(
    reconcileTextDraft(current, { fileKey: "fs:a", text: "new", version: "2" }),
    createTextDraftDocument({ fileKey: "fs:a", text: "new", version: "2" }),
  )
  assert.deepEqual(
    reconcileTextDraft(
      { ...current, draft: "local" },
      { fileKey: "fs:b", text: "other file", version: "1" },
    ),
    createTextDraftDocument({ fileKey: "fs:b", text: "other file", version: "1" }),
  )
})

test("file engine data: dirty drafts retain their base version across external conflicts", () => {
  const dirty = {
    ...createTextDraftDocument({ fileKey: "fs:a", text: "base", version: "1" }),
    draft: "local draft",
  }
  const conflicted = reconcileTextDraft(dirty, {
    fileKey: "fs:a",
    text: "external edit",
    version: "2",
  })

  assert.equal(conflicted.base, "base")
  assert.equal(conflicted.draft, "local draft")
  assert.equal(conflicted.version, "1")
  assert.deepEqual(conflicted.pendingExternal, { text: "external edit", version: "2" })
  assert.deepEqual(
    acceptExternalTextDraft(conflicted),
    createTextDraftDocument({ fileKey: "fs:a", text: "external edit", version: "2" }),
  )
})

test("file engine data: metadata-only bumps and successful saves preserve draft semantics", () => {
  const dirty = {
    ...createTextDraftDocument({ fileKey: "fs:a", text: "base", version: "1" }),
    draft: "local draft",
  }
  const bumped = reconcileTextDraft(dirty, {
    fileKey: "fs:a",
    text: "base",
    version: "2",
  })
  assert.equal(bumped.draft, "local draft")
  assert.equal(bumped.version, "2")
  assert.equal(bumped.pendingExternal, undefined)

  const saved = markTextDraftSaved(bumped, "local draft", "3")
  assert.equal(saved.base, "local draft")
  assert.equal(saved.draft, "local draft")
  assert.equal(saved.version, "3")

  const caughtUp = editTextDraft(
    { ...dirty, pendingExternal: { text: "external edit", version: "4" } },
    "external edit",
  )
  assert.deepEqual(
    caughtUp,
    createTextDraftDocument({ fileKey: "fs:a", text: "external edit", version: "4" }),
  )
})
