import { test } from "node:test"
import assert from "node:assert/strict"
import type { Node, NodeKind, FsCreateInput, FsWritePatch } from "@protocol/node"
import type { NodeResourceRef, ResourceMeta } from "@protocol/resource"
import { FILES_UPDATED } from "@protocol/flowback"
import type { NodeSummary } from "@/files/stores/nodes-store"
import { createResourceFileSystem, resourceFileRef } from "@/filesystem/resource-file-system"
import { FileSystemError } from "@/filesystem/types"
import { createNodeResourceSource, type NodeResourceSourceDeps } from "./node-source"
import { clearResourceSourcesForTest, registerResourceSource } from "./registry"
import { ResourceSourceError, type ResourceSourceAccessContext } from "./types"

const uiCtx: ResourceSourceAccessContext = { actor: "ui", permissions: [] }
const agentReadCtx: ResourceSourceAccessContext = { actor: "agent", permissions: ["fs:read"] }

const base = {
  parentId: null,
  sortKey: "a0",
  tags: [],
  createdAt: 1,
  updatedAt: 1,
}

function ref(kind: NodeKind, id: string): NodeResourceRef {
  return { scheme: "node", kind, id }
}

function folder(id: string, title = "Folder"): Node {
  return { ...base, id, kind: "folder", title, content: null }
}

function note(id: string, title = "Note", parentId: string | null = null): Node {
  return {
    ...base,
    id,
    parentId,
    kind: "note",
    title,
    content: [{ type: "p", children: [{ text: "secret" }] }],
  }
}

function bookmark(id: string, title = "Bookmark", parentId: string | null = null): Node {
  return {
    ...base,
    id,
    parentId,
    kind: "bookmark",
    title,
    content: { url: "https://example.com", description: "", favicon: "" },
  }
}

function fileNode(id: string, title = "File", parentId: string | null = null): Node {
  return {
    ...base,
    id,
    parentId,
    kind: "file",
    title,
    blobRef: { store: "blobs", key: id, size: 4, mime: "text/plain" },
    content: null,
  }
}

function summary(node: Node): NodeSummary {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    parentId: node.parentId,
    sortKey: node.sortKey,
    hasChildren: false,
    mime: node.kind === "file" ? node.blobRef.mime : undefined,
  }
}

async function rejectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ResourceSourceError)
    assert.equal(error.code, code)
    return true
  })
}

function withWindow<T>(run: (target: EventTarget) => T): T {
  const previous = globalThis.window
  const target = new EventTarget()
  Object.defineProperty(globalThis, "window", { value: target, configurable: true })
  try {
    return run(target)
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "window")
    else Object.defineProperty(globalThis, "window", { value: previous, configurable: true })
  }
}

function makeDeps(nodes: Node[]): {
  deps: NodeResourceSourceDeps
  calls: {
    create: FsCreateInput[]
    createFile: File[]
    update: Array<{ kind: NodeKind; id: string; patch: FsWritePatch }>
    move: Array<{
      kind: NodeKind
      id: string
      parentId: string | null
      afterSortKey?: string | null
    }>
    delete: Array<{ kind: NodeKind; id: string }>
    restore: string[]
    writeBlob: Array<{ id: string; content: string; mime?: string }>
  }
} {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const calls = {
    create: [] as FsCreateInput[],
    createFile: [] as File[],
    update: [] as Array<{ kind: NodeKind; id: string; patch: FsWritePatch }>,
    move: [] as Array<{
      kind: NodeKind
      id: string
      parentId: string | null
      afterSortKey?: string | null
    }>,
    delete: [] as Array<{ kind: NodeKind; id: string }>,
    restore: [] as string[],
    writeBlob: [] as Array<{ id: string; content: string; mime?: string }>,
  }
  return {
    calls,
    deps: {
      async listNodeSummaries(kinds) {
        const want = new Set(kinds)
        const summaries = [...byId.values()].filter((node) => want.has(node.kind)).map(summary)
        return summaries.map((item) => ({
          ...item,
          hasChildren: summaries.some((child) => child.parentId === item.id),
        }))
      },
      async getNodeRaw(id) {
        return byId.get(id)
      },
      async getNodesRaw(ids) {
        return ids.map((id) => byId.get(id))
      },
      async createNode(input: FsCreateInput) {
        calls.create.push(input)
        const created = note(`created-${calls.create.length}`, input.title ?? "", input.parentId)
        byId.set(created.id, created)
        return created
      },
      async createFile(file) {
        calls.createFile.push(file)
        const created = fileNode(`file-${calls.createFile.length}`, file.name)
        byId.set(created.id, created)
        return {
          id: created.id,
          name: created.title,
          type: file.type,
          size: file.size,
          createdAt: created.createdAt,
          tags: [],
        }
      },
      async updateNode(kind, id, patch) {
        calls.update.push({ kind, id, patch })
        const existing = byId.get(id)
        if (!existing || existing.kind !== kind) return undefined
        const updated = { ...existing, ...patch, updatedAt: existing.updatedAt + 1 } as Node
        byId.set(id, updated)
        return updated
      },
      async moveNode(kind, id, parentId, afterSortKey) {
        calls.move.push({ kind, id, parentId, afterSortKey })
        const existing = byId.get(id)
        if (!existing || existing.kind !== kind) return undefined
        const updated = { ...existing, parentId, updatedAt: existing.updatedAt + 1 } as Node
        byId.set(id, updated)
        return updated
      },
      async deleteNode(kind, id) {
        calls.delete.push({ kind, id })
      },
      async restoreNode(_kind, id) {
        calls.restore.push(id)
        const existing = byId.get(id)
        if (!existing) return
        const { deletedAt: _deletedAt, ...restored } = existing
        byId.set(id, { ...restored, updatedAt: existing.updatedAt + 1 } as Node)
      },
      async readBlob(id) {
        return byId.has(id) ? new Blob(["test"], { type: "text/plain" }) : undefined
      },
      async readBlobBase64(id) {
        return byId.has(id) ? { mime: "text/plain", size: 4, base64: "dGVzdA==" } : undefined
      },
      async updateFileContent(id, content, mime) {
        calls.writeBlob.push({ id, content, mime })
        const existing = byId.get(id)
        if (!existing || existing.kind !== "file") return undefined
        byId.set(id, {
          ...existing,
          updatedAt: existing.updatedAt + 1,
          blobRef: {
            ...existing.blobRef,
            size: content.length,
            mime: mime || existing.blobRef.mime,
          },
        })
        return { id }
      },
    },
  }
}

test("node provider: create owns root and child note creation", async () => {
  const parent = note("parent")
  const { deps, calls } = makeDeps([parent])
  const provider = createNodeResourceSource(deps)

  await rejectCode(
    provider.create?.(
      { kind: "note", parentId: null },
      { actor: "agent", permissions: [] },
    ) as Promise<unknown>,
    "permission-denied",
  )

  const root = await provider.create?.(
    { kind: "note", title: "Root", parentId: null },
    { actor: "agent", permissions: ["fs.notes:write"], intent: "action" },
  )
  assert.equal(root?.meta.ref.id, "created-1")

  const child = await provider.invoke(
    ref("note", parent.id),
    "create",
    { title: "Child" },
    { actor: "ui", permissions: [], intent: "action" },
  )
  assert.equal((child as { meta: ResourceMeta }).meta.ref.id, "created-2")
  assert.deepEqual(calls.create, [
    { kind: "note", parentId: null, title: "Root" },
    { kind: "note", parentId: parent.id, title: "Child" },
  ])

  const upload = Object.assign(new Blob(["body"], { type: "text/plain" }), {
    name: "upload.txt",
    lastModified: 1,
  }) as File
  const file = await provider.create?.(
    { kind: "file", file: upload },
    { actor: "ui", permissions: [], intent: "action" },
  )
  assert.equal(file?.meta.ref.kind, "file")
  assert.equal(calls.createFile[0], upload)
})

test("node provider: list filters kind/parent/text and paginates metadata", async () => {
  const root = folder("root")
  const plan = { ...note("n1", "Plan", root.id), sortKey: "a1" } as Node
  const file = { ...fileNode("f1", "Plain text", root.id), sortKey: "a2" } as Node
  const outside = bookmark("b1", "Outside")
  const { deps } = makeDeps([root, plan, file, outside])
  const provider = createNodeResourceSource(deps)

  await rejectCode(
    provider.list({ scheme: "node" }, { actor: "agent", permissions: [] }),
    "permission-denied",
  )

  const first = await provider.list(
    { scheme: "node", kinds: ["note", "file"], parent: ref("folder", root.id), limit: 1 },
    agentReadCtx,
  )
  assert.deepEqual(
    first.items.map((item) => item.ref.id),
    ["n1"],
  )
  assert.equal(first.nextCursor, "1")

  const second = await provider.list(
    { scheme: "node", kinds: ["note", "file"], parent: ref("folder", root.id), cursor: "1" },
    agentReadCtx,
  )
  assert.deepEqual(
    second.items.map((item) => item.ref.id),
    ["f1"],
  )

  const text = await provider.list({ scheme: "node", kind: "file", text: "plain" }, agentReadCtx)
  assert.deepEqual(
    text.items.map((item) => item.ref.id),
    ["f1"],
  )
  assert.equal(text.items[0]?.iconHint, "text/plain")
})

test("node provider: list metadata includes tree parent and hasChildren when parent is in query", async () => {
  const root = folder("root")
  const nested = bookmark("b1", "Nested", root.id)
  const provider = createNodeResourceSource(makeDeps([root, nested]).deps)

  const page = await provider.list({ scheme: "node", kinds: ["folder", "bookmark"] }, agentReadCtx)
  const folderMeta = page.items.find((item) => item.ref.id === root.id)
  const bookmarkMeta = page.items.find((item) => item.ref.id === nested.id)

  assert.equal(folderMeta?.hasChildren, true)
  assert.deepEqual(bookmarkMeta?.parent, ref("folder", root.id))
})

test("node provider: note content requires notes permission or active resource consent", async () => {
  const node = note("n1", "Private")
  const provider = createNodeResourceSource(makeDeps([node]).deps)
  const nodeRef = ref("note", node.id)

  await rejectCode(provider.get(nodeRef, agentReadCtx), "consent-required")

  const metadataOnly = await provider.get(nodeRef, { ...agentReadCtx, intent: "metadata" })
  assert.equal(metadataOnly?.meta.title, "Private")
  assert.deepEqual((metadataOnly?.content as Node & { kind: "note" }).content, [])

  const byGrant = await provider.get(nodeRef, {
    actor: "agent",
    permissions: ["fs:read", "fs.notes:read"],
  })
  assert.deepEqual((byGrant?.content as Node & { kind: "note" }).content, node.content)

  const byActiveRef = await provider.get(nodeRef, { ...agentReadCtx, activeRef: nodeRef })
  assert.deepEqual((byActiveRef?.content as Node & { kind: "note" }).content, node.content)

  const byUi = await provider.get(nodeRef, uiCtx)
  assert.deepEqual((byUi?.content as Node & { kind: "note" }).content, node.content)
})

test("node provider: getMany preserves order, unknowns, and per-node privacy guards", async () => {
  const privateNote = note("n-batch", "Private batch")
  const publicBookmark = bookmark("b-batch", "Public batch")
  const { deps } = makeDeps([privateNote, publicBookmark])
  const getNodesRaw = deps.getNodesRaw
  const batches: string[][] = []
  deps.getNodesRaw = async (ids) => {
    batches.push([...ids])
    return getNodesRaw(ids)
  }
  deps.getNodeRaw = async () => {
    throw new Error("getMany must not open one storage read per ref")
  }
  const provider = createNodeResourceSource(deps)
  const refs = [
    ref("bookmark", publicBookmark.id),
    ref("note", privateNote.id),
    ref("bookmark", privateNote.id),
    ref("note", "missing"),
  ]

  const metadata = await provider.getMany!(refs, { ...agentReadCtx, intent: "metadata" })
  assert.deepEqual(batches, [["b-batch", "n-batch", "n-batch", "missing"]])
  assert.deepEqual(
    metadata.map((record) => record?.meta.ref.id ?? null),
    ["b-batch", "n-batch", null, null],
  )
  assert.deepEqual((metadata[1]?.content as Extract<Node, { kind: "note" }>).content, [])

  await rejectCode(provider.getMany!(refs.slice(0, 2), agentReadCtx), "consent-required")
  const granted = await provider.getMany!(refs.slice(0, 2), {
    ...agentReadCtx,
    permissions: ["fs:read", "fs.notes:read"],
  })
  assert.deepEqual(
    (granted[1]?.content as Extract<Node, { kind: "note" }>).content,
    privateNote.content,
  )
})

test("node provider: read-blob requires blob permission and only supports files", async () => {
  const provider = createNodeResourceSource(makeDeps([fileNode("f1"), note("n1")]).deps)

  await rejectCode(
    provider.invoke(ref("file", "f1"), "read-blob", null, { actor: "agent", permissions: [] }),
    "consent-required",
  )
  await rejectCode(
    provider.invoke(ref("note", "n1"), "read-blob", null, {
      actor: "agent",
      permissions: ["fs.blobs:read"],
    }),
    "unsupported",
  )

  assert.deepEqual(
    await provider.invoke(ref("file", "f1"), "read-blob", null, {
      actor: "agent",
      permissions: ["fs.blobs:read"],
    }),
    { mime: "text/plain", size: 4, base64: "dGVzdA==" },
  )
  const uiBlob = await provider.invoke(ref("file", "f1"), "read-blob", null, uiCtx)
  assert.ok(uiBlob instanceof Blob)
  assert.equal(await uiBlob.text(), "test")
})

test("node provider: write-blob persists text under the existing write guard", async () => {
  const { deps, calls } = makeDeps([fileNode("f1"), note("n1")])
  const provider = createNodeResourceSource(deps)

  await rejectCode(
    provider.invoke(ref("file", "f1"), "write-blob", { content: "next" }, agentReadCtx),
    "permission-denied",
  )
  await rejectCode(
    provider.invoke(ref("note", "n1"), "write-blob", { content: "next" }, uiCtx),
    "unsupported",
  )
  await provider.invoke(
    ref("file", "f1"),
    "write-blob",
    { content: "next", mime: "text/markdown" },
    { actor: "agent", permissions: ["fs:write"] },
  )
  assert.deepEqual(calls.writeBlob, [{ id: "f1", content: "next", mime: "text/markdown" }])
})

test("node provider: navigate returns bookmark url", async () => {
  const provider = createNodeResourceSource(makeDeps([bookmark("b1"), note("n1")]).deps)

  assert.deepEqual(await provider.invoke(ref("bookmark", "b1"), "navigate", null, agentReadCtx), {
    ref: ref("bookmark", "b1"),
    url: "https://example.com",
  })
  await rejectCode(
    provider.invoke(ref("note", "n1"), "navigate", null, agentReadCtx),
    "unsupported",
  )
})

test("node provider: edit/move/delete enforce kind-specific write grants", async () => {
  const { deps, calls } = makeDeps([note("n1"), bookmark("b1"), fileNode("f1")])
  const provider = createNodeResourceSource(deps)

  await rejectCode(
    provider.invoke(
      ref("note", "n1"),
      "edit",
      { title: "New" },
      { actor: "agent", permissions: ["fs:write"] },
    ),
    "permission-denied",
  )
  await provider.invoke(
    ref("note", "n1"),
    "edit",
    { title: "New", tags: ["x"] },
    { actor: "agent", permissions: ["fs.notes:write"] },
  )
  assert.deepEqual(calls.update[0], {
    kind: "note",
    id: "n1",
    patch: { title: "New", tags: ["x"] },
  })

  await provider.invoke(
    ref("bookmark", "b1"),
    "move",
    { parentId: "folder-1", afterSortKey: "a9" },
    { actor: "agent", permissions: ["fs:write"] },
  )
  assert.deepEqual(calls.move[0], {
    kind: "bookmark",
    id: "b1",
    parentId: "folder-1",
    afterSortKey: "a9",
  })

  await provider.invoke(ref("file", "f1"), "delete", null, {
    actor: "agent",
    permissions: ["fs:write"],
  })
  assert.deepEqual(calls.delete[0], { kind: "file", id: "f1" })
})

test("node provider: restore revives a deleted file through the write boundary", async () => {
  const deleted = { ...fileNode("f1"), deletedAt: 5 } as Node
  const { deps, calls } = makeDeps([deleted])
  const provider = createNodeResourceSource(deps)

  await rejectCode(
    provider.invoke(ref("file", "f1"), "restore", null, agentReadCtx),
    "permission-denied",
  )
  const restored = await provider.invoke(ref("file", "f1"), "restore", null, {
    actor: "agent",
    permissions: ["fs:write"],
  })

  assert.deepEqual(calls.restore, ["f1"])
  assert.equal((restored as { meta: ResourceMeta }).meta.ref.id, "f1")
})

test("node provider: tombstones are not found through FileSystem but remain restorable", async () => {
  const deleted = { ...fileNode("f-deleted", "deleted.txt"), deletedAt: 5 } as Node
  const { deps, calls } = makeDeps([deleted])
  const provider = createNodeResourceSource(deps)
  const nodeRef = ref("file", deleted.id)

  await rejectCode(provider.get(nodeRef, uiCtx), "not-found")
  await rejectCode(provider.actions(nodeRef, uiCtx), "not-found")
  await rejectCode(provider.invoke(nodeRef, "read-blob", null, uiCtx), "not-found")

  clearResourceSourcesForTest()
  const unregister = registerResourceSource(provider)
  try {
    const fileSystem = createResourceFileSystem()
    const fileRef = resourceFileRef(nodeRef)
    const fileSystemUiCtx = { actor: "ui" as const, permissions: [] }
    assert.equal(await fileSystem.stat(fileRef, fileSystemUiCtx), null)
    await assert.rejects(
      fileSystem.read(fileRef, { ...fileSystemUiCtx, intent: "content" }, { encoding: "binary" }),
      (error) => error instanceof FileSystemError && error.code === "not-found",
    )

    await fileSystem.invoke(fileRef, "restore", null, {
      ...fileSystemUiCtx,
      intent: "action",
    })
    assert.deepEqual(calls.restore, [deleted.id])
    assert.equal((await fileSystem.stat(fileRef, fileSystemUiCtx))?.ref.fileId, fileRef.fileId)
  } finally {
    unregister()
    clearResourceSourcesForTest()
  }
})

test("node provider: actions expose node capabilities without UI components", async () => {
  const provider = createNodeResourceSource(makeDeps([fileNode("f1")]).deps)
  const actions = await provider.actions(ref("file", "f1"), agentReadCtx)

  assert.ok(actions.some((action) => action.id === "read-blob"))
  assert.ok(actions.every((action) => typeof action.label === "string"))
})

test("node provider: watch filters exact resources by kind and id", () => {
  withWindow((target) => {
    const provider = createNodeResourceSource(makeDeps([note("n1")]).deps)
    let collectionCount = 0
    let exactCount = 0
    const collectionHandle = provider.watch!(
      { scheme: "node", kind: "note" },
      uiCtx,
      () => collectionCount++,
    )
    const exactHandle = provider.watch!(
      { scheme: "node", kind: "note", id: "n1" },
      uiCtx,
      () => exactCount++,
    )
    assert.ok(collectionHandle)
    assert.ok(exactHandle)

    target.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: { kind: "bookmark" } }))
    assert.deepEqual([collectionCount, exactCount], [0, 0])
    target.dispatchEvent(
      new CustomEvent(FILES_UPDATED, { detail: { kind: "note", id: "another-note" } }),
    )
    assert.deepEqual([collectionCount, exactCount], [1, 0])
    target.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: { kind: "note", id: "n1" } }))
    assert.deepEqual([collectionCount, exactCount], [2, 1])
    target.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: { kind: "note" } }))
    assert.deepEqual([collectionCount, exactCount], [3, 2])
    target.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: {} }))
    assert.deepEqual([collectionCount, exactCount], [4, 3])

    collectionHandle.dispose()
    exactHandle.dispose()
    target.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: { kind: "note" } }))
    assert.deepEqual([collectionCount, exactCount], [4, 3])
  })
})
