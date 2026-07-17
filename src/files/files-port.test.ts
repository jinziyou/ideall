import assert from "node:assert/strict"
import { readFile as readSource } from "node:fs/promises"
import { test } from "node:test"
import type { FileRef, IdeallFile } from "@protocol/file-system"
import type { ThreadTaskStoragePort } from "@protocol/files"
import type { Node, NodeKind } from "@protocol/node"
import { feedNodeId } from "@/files/feed-node"
import {
  corePlaceRef,
  resourceFileRef,
  resourceRefForFile,
} from "@/filesystem/resource-file-system"
import { FileSystemError } from "@/filesystem/types"
import { createFileSystemFilesPort, type FileSystemFilesGateway } from "./files-port"

type Operation = {
  method: string
  ref: FileRef
  intent?: string
  action?: string
  expectedVersion?: string | null
}

function fixture() {
  let sequence = 0
  const now = 100
  const nodes = new Map<string, Node>()
  const operations: Operation[] = []
  const put = (node: Node) => nodes.set(`${node.kind}:${node.id}`, node)
  put({
    id: "feed-a",
    kind: "feed",
    title: "A",
    parentId: null,
    sortKey: "a",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: { type: "publisher", key: "a.example", favicon: "" },
  })
  put({
    id: "folder-a",
    kind: "folder",
    title: "Folder",
    parentId: null,
    sortKey: "a",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: null,
  })
  put({
    id: "bookmark-a",
    kind: "bookmark",
    title: "Bookmark",
    parentId: "folder-a",
    sortKey: "a",
    tags: [],
    createdAt: 2,
    updatedAt: 2,
    content: { url: "https://example.test", description: "", favicon: "" },
  })

  const file = (node: Node): IdeallFile => ({
    ref: resourceFileRef({ scheme: "node", kind: node.kind, id: node.id }),
    kind: node.kind === "folder" || node.kind === "note" ? "directory" : "file",
    name: node.title,
    mediaType: "application/json",
    capabilities: ["read", "write", "actions"],
    source: { kind: "local", id: "test" },
    version: String(node.updatedAt),
    properties: {
      hasChildren: [...nodes.values()].some(
        (candidate) => candidate.parentId === node.id && candidate.kind === node.kind,
      ),
    },
  })
  const nodeForRef = (ref: FileRef) => {
    const resource = resourceRefForFile(ref)
    return resource?.scheme === "node" ? nodes.get(`${resource.kind}:${resource.id}`) : undefined
  }
  const placeKinds = (ref: FileRef): NodeKind[] => {
    if (ref.fileId === corePlaceRef("subscriptions").fileId) return ["feed"]
    if (ref.fileId === corePlaceRef("bookmarks").fileId) return ["folder", "bookmark"]
    if (ref.fileId === corePlaceRef("home").fileId) return ["thread"]
    if (ref.fileId === corePlaceRef("notes").fileId) return ["note"]
    if (ref.fileId === corePlaceRef("files").fileId) return ["file"]
    return []
  }
  const gateway: FileSystemFilesGateway = {
    async stat(ref, ctx) {
      operations.push({ method: "stat", ref, intent: ctx.intent })
      const node = nodeForRef(ref)
      return node ? file(node) : null
    },
    async readDirectory(ref, ctx, options) {
      operations.push({ method: "readDirectory", ref, intent: ctx.intent })
      const parentNode = nodeForRef(ref)
      const kinds = parentNode ? [parentNode.kind] : placeKinds(ref)
      const parentId = parentNode?.id ?? null
      const entries = [...nodes.values()]
        .filter((node) => {
          if (options?.recursive && !parentNode) return kinds.includes(node.kind)
          if (parentNode?.kind === "folder")
            return node.kind === "bookmark" && node.parentId === parentId
          if (parentNode?.kind === "note") return node.kind === "note" && node.parentId === parentId
          return kinds.includes(node.kind) && node.parentId === null
        })
        .map((node) => {
          const target = file(node)
          return {
            entryId: node.id,
            parent:
              options?.recursive && node.parentId
                ? file([...nodes.values()].find((candidate) => candidate.id === node.parentId)!).ref
                : ref,
            target: target.ref,
            name: node.title,
            kind: "child" as const,
            file: target,
            properties: target.properties,
          }
        })
      return { entries }
    },
    async read(ref, ctx) {
      operations.push({ method: "read", ref, intent: ctx.intent })
      const node = nodeForRef(ref)
      if (!node) throw new FileSystemError("not-found", "missing", ref)
      return { data: node, mediaType: "application/json" }
    },
    async write(ref, input, ctx) {
      operations.push({
        method: "write",
        ref,
        intent: ctx.intent,
        expectedVersion: input.expectedVersion,
      })
      const node = nodeForRef(ref)
      if (!node) throw new FileSystemError("not-found", "missing", ref)
      const patch = input.data as Record<string, unknown>
      const next = {
        ...node,
        ...(typeof patch.title === "string" ? { title: patch.title } : {}),
        ...(Array.isArray(patch.tags) ? { tags: patch.tags as string[] } : {}),
        ...(patch.parentId === null || typeof patch.parentId === "string"
          ? { parentId: patch.parentId }
          : {}),
        ...(patch.content && typeof patch.content === "object"
          ? { content: { ...(node as { content?: object }).content, ...patch.content } }
          : {}),
        updatedAt: node.updatedAt + 1,
      } as Node
      put(next)
      return file(next)
    },
    async invoke(ref, action, input, ctx, options) {
      operations.push({
        method: "invoke",
        ref,
        intent: ctx.intent,
        action,
        expectedVersion: options?.expectedVersion,
      })
      const place = ref.fileId.startsWith("place:") ? ref.fileId.slice("place:".length) : null
      if (place && action === "create") {
        const raw = input as Record<string, unknown>
        const kind = raw.kind as NodeKind
        const content = (raw.content ??
          (raw.kind === "thread" ? { messages: [] } : null)) as Node["content"]
        const id =
          kind === "feed"
            ? feedNodeId(
                (content as Extract<Node, { kind: "feed" }>["content"]).type,
                (content as Extract<Node, { kind: "feed" }>["content"]).key,
              )
            : `${kind}-${++sequence}`
        const node = {
          id,
          kind,
          title: typeof raw.title === "string" ? raw.title : kind === "thread" ? "新对话" : "",
          parentId: typeof raw.parentId === "string" ? raw.parentId : null,
          sortKey: String(sequence),
          tags: Array.isArray(raw.tags) ? raw.tags : [],
          createdAt: now + sequence,
          updatedAt: now + sequence,
          ...(kind === "file" ? {} : { content }),
        } as Node
        put(node)
        return { ref: file(node).ref }
      }
      const node = nodeForRef(ref)
      if (!node) throw new FileSystemError("not-found", "missing", ref)
      if (action === "delete") {
        nodes.delete(`${node.kind}:${node.id}`)
        return { ref, deleted: true }
      }
      if (action === "move") {
        const raw = input as { parentId: string | null; afterSortKey?: string | null }
        put({ ...node, parentId: raw.parentId, sortKey: raw.afterSortKey ?? node.sortKey })
        return { ref }
      }
      return { ref }
    },
  }
  return { gateway, nodes, operations, put }
}

test("filesystem FilesPort: reads nested domain data exclusively through the gateway", async () => {
  const { gateway, operations } = fixture()
  const port = createFileSystemFilesPort(gateway)

  assert.deepEqual(
    (await port.listSubscriptions()).map((item) => item.key),
    ["a.example"],
  )
  assert.deepEqual(
    (await port.listBookmarks()).map((item) => item.id),
    ["bookmark-a"],
  )
  assert.ok(operations.some((item) => item.method === "readDirectory"))
  assert.ok(operations.some((item) => item.method === "read"))
  assert.ok(operations.every((item) => item.intent === "directory" || item.intent === "content"))

  const source = await readSource(new URL("./files-port.ts", import.meta.url), "utf8")
  assert.doesNotMatch(
    source,
    /files\/stores\//,
    "FilesPort compatibility facade must not import stores",
  )
})

test("filesystem FilesPort: delegates the durable task index head only through injection", async () => {
  const { gateway } = fixture()
  const threadTasks = {
    async readThreadTaskIndexHead() {
      return { revision: 12, count: 3 }
    },
  } as ThreadTaskStoragePort
  const port = createFileSystemFilesPort(gateway, { threadTasks })

  assert.deepEqual(await port.readThreadTaskIndexHead(), { revision: 12, count: 3 })
  await assert.rejects(
    () => createFileSystemFilesPort(gateway).readThreadTaskIndexHead(),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
})

test("filesystem FilesPort: common mutations use create/write/action FileSystem operations", async () => {
  const { gateway, nodes, operations } = fixture()
  const port = createFileSystemFilesPort(gateway)

  const subscription = await port.addSubscription({
    type: "publisher",
    key: "new.example",
    title: "New",
  })
  assert.equal(subscription.key, "new.example")
  await port.updateBookmark("bookmark-a", { title: "Renamed" })
  assert.equal(nodes.get("bookmark:bookmark-a")?.title, "Renamed")
  await port.deleteBookmark("bookmark-a")
  assert.equal(nodes.has("bookmark:bookmark-a"), false)

  const thread = await port.createThread()
  await port.saveThread({ ...thread, messages: [{ role: "user", content: "hi" }] })
  assert.deepEqual(
    (nodes.get(`thread:${thread.id}`) as Extract<Node, { kind: "thread" }>).content.messages,
    [{ role: "user", content: "hi" }],
  )

  assert.ok(
    operations.some(
      (item) =>
        item.method === "invoke" &&
        item.action === "create" &&
        item.ref.fileId === "place:subscriptions",
    ),
  )
  assert.ok(
    operations.some((item) => item.method === "write" && item.ref.fileId.includes("bookmark")),
  )
  assert.ok(operations.some((item) => item.method === "invoke" && item.action === "delete"))
  assert.ok(
    operations.some(
      (item) =>
        item.method === "invoke" && item.action === "create" && item.ref.fileId === "place:home",
    ),
  )
  assert.ok(
    operations.every((item) =>
      ["metadata", "content", "write", "action"].includes(item.intent ?? ""),
    ),
  )
})

test("filesystem FilesPort: forwards approval versions to write, move and delete CAS", async () => {
  const { gateway, operations } = fixture()
  const port = createFileSystemFilesPort(gateway)

  await port.fsUpdateNode("bookmark", "bookmark-a", { title: "Versioned" }, "2")
  await port.fsMoveNode("bookmark", "bookmark-a", null, undefined, "3")
  await port.fsDeleteNode("bookmark", "bookmark-a", "3")

  assert.deepEqual(
    operations
      .filter((operation) => operation.method === "write" || operation.action === "move")
      .map((operation) => [operation.method, operation.action, operation.expectedVersion]),
    [
      ["write", undefined, "2"],
      ["invoke", "move", "3"],
    ],
  )
  assert.equal(operations.find((operation) => operation.action === "delete")?.expectedVersion, "3")
})

test("filesystem FilesPort: recursive place projection avoids per-directory full scans", async () => {
  const { gateway, operations, put } = fixture()
  for (let index = 0; index < 100; index += 1) {
    put({
      id: `note-${index}`,
      kind: "note",
      title: `Note ${index}`,
      parentId: index === 0 ? null : `note-${index - 1}`,
      sortKey: String(index),
      tags: [],
      createdAt: index,
      updatedAt: index,
      content: [{ text: String(index) }],
    })
  }

  const notes = await createFileSystemFilesPort(gateway).listNotes()
  assert.equal(notes.length, 100)
  assert.equal(
    operations.filter(
      (operation) => operation.method === "readDirectory" && operation.ref.fileId === "place:notes",
    ).length,
    1,
  )
  assert.equal(
    operations.filter((operation) => operation.method === "readDirectory").length,
    1,
    "nested notes must not trigger one directory scan per node",
  )
})

test("filesystem FilesPort: consumes directory cursors page by page", async () => {
  const { gateway, operations, put } = fixture()
  for (let index = 0; index < 10; index += 1) {
    put({
      id: `paged-${index}`,
      kind: "note",
      title: `Paged ${index}`,
      parentId: null,
      sortKey: String(index),
      tags: [],
      createdAt: index,
      updatedAt: index,
      content: [{ text: String(index) }],
    })
  }
  const readDirectory = gateway.readDirectory
  gateway.readDirectory = async (ref, ctx, options) => {
    const all = await readDirectory(ref, ctx, options)
    const offset = Number.parseInt(options?.cursor ?? "0", 10)
    const limit = options?.limit ?? all.entries.length
    const next = offset + limit
    return {
      entries: all.entries.slice(offset, next),
      nextCursor: next < all.entries.length ? String(next) : undefined,
    }
  }

  const notes = await createFileSystemFilesPort(gateway, { directoryPageSize: 4 }).listNotes()
  assert.equal(notes.length, 10)
  assert.equal(operations.filter((operation) => operation.method === "readDirectory").length, 3)
})

test("filesystem FilesPort: fallback reads have a configurable finite concurrency", async () => {
  const { gateway, put } = fixture()
  for (let index = 0; index < 18; index += 1) {
    put({
      id: `limited-${index}`,
      kind: "note",
      title: `Limited ${index}`,
      parentId: null,
      sortKey: String(index),
      tags: [],
      createdAt: index,
      updatedAt: index,
      content: [{ text: String(index) }],
    })
  }
  const read = gateway.read
  let active = 0
  let maxActive = 0
  gateway.read = async (...args) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    try {
      return await read(...args)
    } finally {
      active -= 1
    }
  }

  const nodes = await createFileSystemFilesPort(gateway, {
    readConcurrency: 3,
  }).fsListNodes(["note"])
  assert.equal(nodes.length, 18)
  assert.equal(maxActive, 3)
})

test("filesystem FilesPort: uses ordered provider batches once per directory page", async () => {
  const { gateway, nodes, operations, put } = fixture()
  for (let index = 0; index < 8; index += 1) {
    put({
      id: `batch-${index}`,
      kind: "note",
      title: `Batch ${index}`,
      parentId: null,
      sortKey: String(index),
      tags: [],
      createdAt: index,
      updatedAt: index,
      content: [{ text: String(index) }],
    })
  }
  const readDirectory = gateway.readDirectory
  gateway.readDirectory = async (ref, ctx, options) => {
    const all = await readDirectory(ref, ctx, options)
    const offset = Number.parseInt(options?.cursor ?? "0", 10)
    const limit = options?.limit ?? all.entries.length
    const next = offset + limit
    return {
      entries: all.entries.slice(offset, next),
      nextCursor: next < all.entries.length ? String(next) : undefined,
    }
  }
  const batches: string[][] = []
  gateway.readMany = async (refs, ctx) => {
    assert.equal(ctx.intent, "content")
    batches.push(refs.map((ref) => ref.fileId))
    return refs.map((ref) => {
      const resource = resourceRefForFile(ref)
      const node = resource?.scheme === "node" ? nodes.get(`${resource.kind}:${resource.id}`) : null
      return node ? { data: node, mediaType: "application/json" } : null
    })
  }

  const result = await createFileSystemFilesPort(gateway, {
    directoryPageSize: 3,
  }).fsListNodes(["note"])
  assert.equal(result.length, 8)
  assert.equal(batches.length, 3)
  assert.equal(operations.filter((operation) => operation.method === "read").length, 0)
})

test("filesystem FilesPort: only not-found is omitted; permission errors propagate", async () => {
  const { gateway, put } = fixture()
  put({
    id: "visible-note",
    kind: "note",
    title: "Visible",
    parentId: null,
    sortKey: "a",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: [],
  })
  const readDirectory = gateway.readDirectory
  gateway.readDirectory = async (ref, ctx, options) => {
    const page = await readDirectory(ref, ctx, options)
    if (ref.fileId !== corePlaceRef("notes").fileId) return page
    const missing = resourceFileRef({ scheme: "node", kind: "note", id: "missing-note" })
    return {
      entries: [
        ...page.entries,
        {
          entryId: "missing-note",
          parent: ref,
          target: missing,
          name: "Missing",
          kind: "child" as const,
        },
      ],
    }
  }
  assert.deepEqual(
    (await createFileSystemFilesPort(gateway).listNotes()).map((note) => note.id),
    ["visible-note"],
  )

  const read = gateway.read
  gateway.read = async (ref, ctx, options) => {
    const resource = resourceRefForFile(ref)
    if (resource?.id === "visible-note") {
      throw new FileSystemError("permission-denied", "private", ref)
    }
    return read(ref, ctx, options)
  }
  await assert.rejects(
    () => createFileSystemFilesPort(gateway).listNotes(),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
})

test("filesystem FilesPort: rejects malformed batches and repeated directory cursors", async () => {
  const first = fixture()
  first.put({
    id: "batch-shape",
    kind: "note",
    title: "Batch shape",
    parentId: null,
    sortKey: "a",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: [],
  })
  first.gateway.readMany = async () => []
  await assert.rejects(
    () => createFileSystemFilesPort(first.gateway).listNotes(),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  first.gateway.readMany = async () => new Array(1) as Array<null>
  await assert.rejects(
    () => createFileSystemFilesPort(first.gateway).listNotes(),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )

  const second = fixture()
  second.gateway.readDirectory = async () => ({ entries: [], nextCursor: "stuck" })
  await assert.rejects(
    () => createFileSystemFilesPort(second.gateway).listNotes(),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
})

test("filesystem FilesPort: listNoteChildren queries only the requested parent directory", async () => {
  const { gateway, operations, put } = fixture()
  const makeNote = (id: string, parentId: string | null, sortKey: string): Node => ({
    id,
    kind: "note",
    title: id,
    parentId,
    sortKey,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: [],
  })
  put(makeNote("root-note", null, "a"))
  put(makeNote("direct-child", "root-note", "a"))
  put(makeNote("grandchild", "direct-child", "a"))
  put(makeNote("other-root", null, "b"))

  const children = await createFileSystemFilesPort(gateway).listNoteChildren("root-note")
  assert.deepEqual(
    children.map((note) => ({
      id: note.id,
      parentId: note.parentId,
      hasChildren: note.hasChildren,
    })),
    [{ id: "direct-child", parentId: "root-note", hasChildren: true }],
  )
  const directoryReads = operations.filter((operation) => operation.method === "readDirectory")
  assert.equal(directoryReads.length, 1)
  assert.equal(resourceRefForFile(directoryReads[0]!.ref)?.id, "root-note")
  assert.deepEqual(
    operations
      .filter((operation) => operation.method === "read")
      .map((operation) => resourceRefForFile(operation.ref)?.id),
    ["direct-child"],
  )
})
