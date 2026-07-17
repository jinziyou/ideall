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
  materializeLocalSemanticResults,
  runtimeConnectorSearchItemsFromEntries,
  searchLocalIndexDocuments,
  type LoadLocalSearchItemsOptions,
  type LocalSearchSource,
} from "./local-search-items"
import { mergeLocalSemanticRanks } from "./local-semantic-search"
import type { LocalSearchIndexDocument } from "@/files/local-search-index-store"

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
    ["文件", "关注", "书签", "资源", "对话"],
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
  assert.deepEqual(items.find((item) => item.group === "书签")?.context, {
    key: "node:bookmark:b1",
    type: "node",
    kind: "bookmark",
    id: "b1",
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
      { group: "文件", place: "notes", kind: "note" },
      { group: "关注", place: "subscriptions", kind: "feed" },
      { group: "书签", place: "bookmarks", kind: "bookmark" },
      { group: "资源", place: "files", kind: "file" },
      { group: "对话", place: "workspace", kind: "thread" },
    ],
  )
  assert.ok(calls.every(({ options }) => options.text === "  Alpha  "))
  assert.ok(calls.every(({ options }) => options.limitPerGroup === 7))
})

test("local search: appends authorized connector FileSystem results without indexing content", async () => {
  const connectorRef = {
    fileSystemId: "runtime-extension.acme.search",
    fileId: `resource:${"a".repeat(64)}`,
  }
  const connectorCalls: LoadLocalSearchItemsOptions[] = []
  const items = await loadLocalSearchItems(
    { text: "report", limitPerGroup: 3 },
    async () => [],
    async () => {
      assert.fail("connector search must not read resource content")
    },
    async (options) => {
      connectorCalls.push(options)
      return [
        {
          id: "connector-result",
          label: "Quarterly Report",
          group: "连接器",
          hint: "来源 · Acme Search",
          target: { type: "file", ref: connectorRef, title: "Quarterly Report" },
          run: () => undefined,
        },
      ]
    },
  )

  assert.deepEqual(connectorCalls, [{ text: "report", limitPerGroup: 3 }])
  assert.deepEqual(
    items.map((item) => item.group),
    ["连接器"],
  )
  assert.deepEqual(items[0]?.target, {
    type: "file",
    ref: connectorRef,
    title: "Quarterly Report",
  })
})

test("local search: connector metadata search keeps title priority and opaque targets", () => {
  const parent = {
    fileSystemId: "runtime-extension.acme.search",
    fileId: "resources",
  }
  const connectorEntry = (
    id: string,
    name: string,
    description: string,
    mediaType: string,
  ): DirectoryEntry => ({
    entryId: id,
    parent,
    target: { fileSystemId: parent.fileSystemId, fileId: `resource:${id}` },
    name,
    kind: "child",
    file: {
      ref: { fileSystemId: parent.fileSystemId, fileId: `resource:${id}` },
      kind: "file",
      name,
      mediaType,
      capabilities: ["read"],
      source: { kind: "third-party", id: "acme.search" },
    },
    properties: {
      runtimeExtensionSearchable: true,
      searchDescription: description,
      extensionLabel: "Acme Search",
    },
  })
  const entries = [
    connectorEntry("title", "Research Report", "other", "text/plain"),
    connectorEntry("description", "Quarterly File", "research evidence", "text/markdown"),
    connectorEntry("hidden", "Hidden", "research", "application/json"),
  ]
  entries[2].properties = { runtimeExtensionSearchable: false }

  const byText = runtimeConnectorSearchItemsFromEntries(entries, {
    text: "research",
    limitPerGroup: 2,
  })
  assert.deepEqual(
    byText.map((item) => [item.label, item.hint]),
    [
      ["Research Report", undefined],
      ["Quarterly File", "描述 · research evidence"],
    ],
  )
  const byType = runtimeConnectorSearchItemsFromEntries(entries, { text: "markdown" })
  assert.deepEqual(
    byType.map((item) => item.hint),
    ["类型 · text/markdown"],
  )
  assert.doesNotMatch(JSON.stringify([...byText, ...byType]), /private:\/\/|uri|token=/i)
})

test("local search: matches private content and public metadata through FileSystem reads", async () => {
  const entries = [
    entry("note", "n1", "Weekly note"),
    entry("feed", "f1", "Industry feed"),
    entry("bookmark", "b1", "Reference"),
    entry("file", "r1", "report.bin", "application/octet-stream"),
    entry("thread", "t1", "Research chat"),
  ]
  const contents: Record<string, unknown> = {
    n1: {
      kind: "note",
      tags: [],
      content: [{ type: "p", children: [{ text: "A hidden lighthouse insight" }] }],
    },
    f1: {
      kind: "feed",
      tags: [],
      content: { type: "search", key: "market", searchKeyword: "lighthouse" },
    },
    b1: {
      kind: "bookmark",
      tags: [],
      content: { url: "https://example.com", description: "Lighthouse source material" },
    },
    r1: {
      kind: "file",
      tags: ["lighthouse"],
      blobRef: { mime: "application/octet-stream" },
    },
    t1: {
      kind: "thread",
      tags: [],
      content: { messages: [{ role: "user", content: "Compare lighthouse evidence" }] },
    },
  }

  const items = await loadLocalSearchItems(
    { text: "LIGHTHOUSE" },
    async (source) =>
      entries.filter((item) => resourceRefForFile(item.target)?.kind === source.kind),
    async (requested) =>
      requested.map((item) => {
        const resource = resourceRefForFile(item.target)
        return resource ? contents[resource.id] : null
      }),
  )

  assert.deepEqual(
    items.map((item) => item.group),
    ["文件", "关注", "书签", "资源", "对话"],
  )
  assert.match(items[0]?.hint ?? "", /^正文 · .*lighthouse/i)
  assert.match(items[1]?.hint ?? "", /^关注条件 · .*lighthouse/i)
  assert.match(items[2]?.hint ?? "", /^摘要 · .*Lighthouse/)
  assert.match(items[3]?.hint ?? "", /^标签 · .*lighthouse/)
  assert.match(items[4]?.hint ?? "", /^对话 · .*lighthouse/i)
})

test("local search: title matches take precedence and avoid unnecessary content reads", async () => {
  let contentReads = 0
  const items = await loadLocalSearchItems(
    { text: "alpha", limitPerGroup: 1 },
    async (source) =>
      source.kind === "note"
        ? [entry("note", "n1", "Alpha title"), entry("note", "n2", "Other")]
        : [],
    async () => {
      contentReads += 1
      return []
    },
  )

  assert.equal(items[0]?.label, "Alpha title")
  assert.equal(contentReads, 0)
})

test("local search index: queries derived fields without reading source content", () => {
  const indexed = (
    kind: "note" | "bookmark",
    id: string,
    label: string,
    field: { label: string; value: string },
  ): LocalSearchIndexDocument => {
    const target = entry(kind, id, label).target
    return {
      key: `document:${id}`,
      type: "document",
      target,
      group: kind === "note" ? "文件" : "书签",
      kind,
      label,
      fields: [field],
      sourceVersion: "1",
      indexedAt: 1,
    }
  }
  const documents = [
    indexed("note", "n1", "Lighthouse title", { label: "正文", value: "other" }),
    indexed("note", "n2", "Weekly note", {
      label: "正文",
      value: "A hidden lighthouse insight",
    }),
    indexed("bookmark", "b1", "Reference", {
      label: "摘要",
      value: "Lighthouse source material",
    }),
  ]

  const items = searchLocalIndexDocuments(documents, { text: "LIGHTHOUSE", limitPerGroup: 2 })

  assert.deepEqual(
    items.map((item) => [item.group, item.label]),
    [
      ["文件", "Lighthouse title"],
      ["文件", "Weekly note"],
      ["书签", "Reference"],
    ],
  )
  assert.equal(items[0]?.hint, undefined)
  assert.match(items[1]?.hint ?? "", /^正文 · .*lighthouse/i)
  assert.match(items[2]?.hint ?? "", /^摘要 · .*Lighthouse/)
  assert.equal(items[2]?.context?.key, "node:bookmark:b1")
})

test("local semantic fusion: keeps title and content hits ahead while adding semantic-only results", () => {
  const indexed = (id: string, label: string, value: string): LocalSearchIndexDocument => {
    const target = entry("note", id, label).target
    return {
      key: `document:${id}`,
      type: "document",
      target,
      group: "文件",
      kind: "note",
      label,
      fields: [{ label: "正文", value }],
      sourceVersion: "1",
      indexedAt: 1,
    }
  }
  const documents = [
    indexed("title", "Lighthouse plan", "unrelated"),
    indexed("content", "Weekly note", "lighthouse evidence"),
    indexed("semantic", "Coastal safety", "navigation and visibility"),
  ]
  const options = { text: "lighthouse", limitPerGroup: 3 }
  const lexical = searchLocalIndexDocuments(documents, options)
  const rankedKeys = mergeLocalSemanticRanks(
    documents,
    [
      { documentKey: "document:title", group: "文件", titleMatch: true },
      { documentKey: "document:content", group: "文件", titleMatch: false },
    ],
    new Map([
      ["document:semantic", 0.99],
      ["document:content", 0.8],
      ["document:title", 0.7],
    ]),
    options.limitPerGroup,
  )
  const merged = materializeLocalSemanticResults(documents, lexical, rankedKeys)

  assert.deepEqual(
    merged.map((item) => item.label),
    ["Lighthouse plan", "Weekly note", "Coastal safety"],
  )
  assert.equal(merged[0]?.hint, undefined)
  assert.match(merged[1]?.hint ?? "", /^正文 ·/)
  assert.equal(merged[2]?.hint, "语义相关")
})
