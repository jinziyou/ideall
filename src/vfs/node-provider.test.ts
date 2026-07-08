import { test } from "node:test"
import assert from "node:assert/strict"
import type { Node, NodeKind, FsCreateInput, FsWritePatch } from "@protocol/node"
import type { NodeResourceRef } from "@protocol/resource"
import { FILES_UPDATED } from "@protocol/flowback"
import type { NodeSummary } from "@/files/stores/nodes-store"
import { createNodeVfsProvider, type NodeVfsProviderDeps } from "./node-provider"
import { VfsError, type VfsAccessContext } from "./types"

const uiCtx: VfsAccessContext = { actor: "ui", permissions: [] }
const agentReadCtx: VfsAccessContext = { actor: "agent", permissions: ["fs:read"] }

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
    assert.ok(error instanceof VfsError)
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
  deps: NodeVfsProviderDeps
  calls: {
    update: Array<{ kind: NodeKind; id: string; patch: FsWritePatch }>
    move: Array<{
      kind: NodeKind
      id: string
      parentId: string | null
      afterSortKey?: string | null
    }>
    delete: Array<{ kind: NodeKind; id: string }>
  }
} {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const calls = {
    update: [] as Array<{ kind: NodeKind; id: string; patch: FsWritePatch }>,
    move: [] as Array<{
      kind: NodeKind
      id: string
      parentId: string | null
      afterSortKey?: string | null
    }>,
    delete: [] as Array<{ kind: NodeKind; id: string }>,
  }
  return {
    calls,
    deps: {
      async listNodeSummaries(kinds) {
        const want = new Set(kinds)
        return [...byId.values()].filter((node) => want.has(node.kind)).map(summary)
      },
      async getNodeRaw(id) {
        return byId.get(id)
      },
      async createNode(_input: FsCreateInput) {
        throw new Error("not used")
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
      async readBlobBase64(id) {
        return byId.has(id) ? { mime: "text/plain", size: 4, base64: "dGVzdA==" } : undefined
      },
    },
  }
}

test("node provider: list filters kind/parent/text and paginates metadata", async () => {
  const root = folder("root")
  const plan = { ...note("n1", "Plan", root.id), sortKey: "a1" } as Node
  const file = { ...fileNode("f1", "Plain text", root.id), sortKey: "a2" } as Node
  const outside = bookmark("b1", "Outside")
  const { deps } = makeDeps([root, plan, file, outside])
  const provider = createNodeVfsProvider(deps)

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

test("node provider: note content requires notes permission or active resource consent", async () => {
  const node = note("n1", "Private")
  const provider = createNodeVfsProvider(makeDeps([node]).deps)
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

test("node provider: read-blob requires blob permission and only supports files", async () => {
  const provider = createNodeVfsProvider(makeDeps([fileNode("f1"), note("n1")]).deps)

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
})

test("node provider: edit/move/delete enforce kind-specific write grants", async () => {
  const { deps, calls } = makeDeps([note("n1"), bookmark("b1"), fileNode("f1")])
  const provider = createNodeVfsProvider(deps)

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

test("node provider: actions expose node capabilities without UI components", async () => {
  const provider = createNodeVfsProvider(makeDeps([fileNode("f1")]).deps)
  const actions = await provider.actions(ref("file", "f1"), agentReadCtx)

  assert.ok(actions.some((action) => action.id === "read-blob"))
  assert.ok(actions.every((action) => typeof action.label === "string"))
})

test("node provider: watch forwards matching file update events", () => {
  withWindow((target) => {
    const provider = createNodeVfsProvider(makeDeps([note("n1")]).deps)
    let count = 0
    const handle = provider.watch!({ scheme: "node", kind: "note" }, uiCtx, () => count++)
    assert.ok(handle)

    target.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: { kind: "bookmark" } }))
    assert.equal(count, 0)
    target.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: { kind: "note" } }))
    assert.equal(count, 1)
    target.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: {} }))
    assert.equal(count, 2)

    handle.dispose()
    target.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: { kind: "note" } }))
    assert.equal(count, 2)
  })
})
