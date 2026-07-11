import { test } from "node:test"
import assert from "node:assert/strict"
import type { DirectoryEntry } from "@protocol/file-system"
import {
  corePlaceRef,
  resourceFileRef,
  resourceRefForFile,
} from "@/filesystem/resource-file-system"
import {
  loadLocalSearchItems,
  type LoadLocalSearchItemsOptions,
  type LocalSearchSource,
} from "./local-search-items"

function entry(
  kind: "note" | "feed" | "bookmark" | "file" | "thread",
  id: string,
  name: string,
  mediaType?: string,
): DirectoryEntry {
  return {
    entryId: `${kind}:${id}`,
    parent: corePlaceRef("home"),
    target: resourceFileRef({ scheme: "node", kind, id }),
    name,
    kind: "link",
    properties: mediaType ? { mediaType } : undefined,
  }
}

test("local search: builds content items from FileSystem directory entries", async () => {
  const entries = [
    entry("note", "n1", "Alpha Note"),
    entry("feed", "feed:entity:alpha", "Alpha Feed"),
    entry("bookmark", "b1", "Alpha Bookmark"),
    entry("file", "f1", "readme.md", "text/markdown"),
    entry("thread", "t1", "Alpha Thread"),
  ]

  const items = await loadLocalSearchItems({}, async (source) =>
    entries.filter((item) => resourceRefForFile(item.target)?.kind === source.kind),
  )

  assert.deepEqual(
    items.map((item) => item.group),
    ["笔记", "关注", "书签", "资源", "对话"],
  )
  assert.deepEqual(
    items.map((item) => item.target?.type),
    ["file", "file", "file", "file", "file"],
  )
  assert.deepEqual(items.find((item) => item.group === "资源")?.fileType, {
    name: "readme.md",
    type: "text/markdown",
  })
  assert.deepEqual(items.find((item) => item.group === "书签")?.target, {
    type: "file",
    ref: {
      fileSystemId: "ideall.core",
      fileId: "resource:node%3Abookmark%3Ab1",
    },
    title: "Alpha Bookmark",
  })
})

test("local search: passes normalized source groups and options to the FileSystem loader", async () => {
  const calls: Array<{ source: LocalSearchSource; options: LoadLocalSearchItemsOptions }> = []
  await loadLocalSearchItems({ text: "  Alpha  ", limitPerGroup: 7 }, async (source, options) => {
    calls.push({ source, options })
    return []
  })

  assert.deepEqual(
    calls.map(({ source }) => ({ group: source.group, place: source.place, kind: source.kind })),
    [
      { group: "笔记", place: "notes", kind: "note" },
      { group: "关注", place: "subscriptions", kind: "feed" },
      { group: "书签", place: "bookmarks", kind: "bookmark" },
      { group: "资源", place: "files", kind: "file" },
      { group: "对话", place: "workspace", kind: "thread" },
    ],
  )
  assert.ok(calls.every(({ options }) => options.text === "  Alpha  "))
  assert.ok(calls.every(({ options }) => options.limitPerGroup === 7))
})
