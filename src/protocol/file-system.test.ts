import { test } from "node:test"
import assert from "node:assert/strict"
import {
  fileRefKey,
  fileRefQueryValue,
  isFileRef,
  parseFileRefKey,
  parseFileRefSearch,
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
} from "./file-system"

test("file ref: 文件系统 id 与不透明文件 id 可稳定往返", () => {
  const refs: FileRef[] = [
    { fileSystemId: "local", fileId: "note:1/a?b=c" },
    { fileSystemId: "app:org.ideall.audio", fileId: "%:/:?&=中文" },
  ]

  for (const ref of refs) {
    assert.deepEqual(parseFileRefKey(fileRefKey(ref)), ref)
  }

  const ref = refs[1]
  assert.deepEqual(parseFileRefSearch(`?file=${fileRefQueryValue(ref)}`), ref)
  const params = new URLSearchParams()
  params.set("file", fileRefKey(ref))
  assert.deepEqual(parseFileRefSearch(params.toString()), ref)
})

test("file ref: 非法或畸形输入被拒收", () => {
  assert.equal(isFileRef({ fileSystemId: "local", fileId: "1" }), true)
  assert.equal(isFileRef({ fileSystemId: "", fileId: "1" }), false)
  assert.equal(isFileRef({ fileSystemId: "local" }), false)
  assert.equal(parseFileRefKey("local"), null)
  assert.equal(parseFileRefKey("local:"), null)
  assert.equal(parseFileRefKey("local:a:b"), null)
  assert.equal(parseFileRefKey("local:%"), null)
  assert.throws(() => fileRefKey({ fileSystemId: "", fileId: "1" }), TypeError)
})

test("directory entry: 多个目录项可引用同一文件而不改变文件身份", () => {
  const target: FileRef = { fileSystemId: "local", fileId: "bookmark-1" }
  const entries: DirectoryEntry[] = [
    {
      entryId: "followed-bookmark-1",
      parent: { fileSystemId: "ideall.root", fileId: "following" },
      target,
      name: "关注中的链接",
      kind: "link",
    },
    {
      entryId: "saved-bookmark-1",
      parent: { fileSystemId: "ideall.root", fileId: "bookmarks" },
      target,
      name: "我的书签",
      kind: "link",
    },
  ]

  assert.notEqual(entries[0].entryId, entries[1].entryId)
  assert.equal(sameFileRef(entries[0].target, entries[1].target), true)
})
