import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import type { ResourceMeta, ResourceRecord, ResourceRef } from "@protocol/resource"
import { AGENT_TASKS_FILE_REF } from "@/filesystem/builtin-app-roots"
import {
  clearResourceSourcesForTest,
  registerResourceSource,
} from "@/filesystem/resource-sources/registry"
import type { ResourceSourceProvider } from "@/filesystem/resource-sources/types"
import { ResourceSourceError } from "@/filesystem/resource-sources/types"
import { FileSystemError } from "./types"
import { withFileWriteLock } from "./write-lock"
import {
  aiTasksPanelFileRef,
  corePlaceRef,
  createResourceFileSystem,
  panelForFile,
  panelFileRef,
  resourceFileRef,
  resourceRefForFile,
} from "./resource-file-system"

const ctx = { actor: "ui", permissions: [], intent: "metadata" } as const

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => clearResourceSourcesForTest())

test("resource filesystem: directory pagination uses strict canonical inputs", async () => {
  const fs = createResourceFileSystem()
  const directoryCtx = { actor: "ui", permissions: [], intent: "directory" } as const

  const first = await fs.readDirectory(fs.descriptor.root, directoryCtx, { limit: 2 })
  assert.equal(first.entries.length, 2)
  assert.equal(first.nextCursor, "2")

  const second = await fs.readDirectory(fs.descriptor.root, directoryCtx, {
    cursor: first.nextCursor,
    limit: 2,
  })
  assert.equal(second.entries.length, 2)
  assert.equal(second.nextCursor, "4")
  assert.equal(second.entries[0]?.sortKey, "00002", "分页后仍保留全目录排序位置")

  for (const options of [
    { cursor: "1x" },
    { cursor: "-1" },
    { cursor: "9007199254740992" },
    { limit: 0 },
    { limit: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    await assert.rejects(
      fs.readDirectory(fs.descriptor.root, directoryCtx, options),
      (error) => error instanceof FileSystemError && error.code === "invalid-input",
    )
  }
})

test("resource filesystem: note roots and child pages are created through resource source actions", async () => {
  const parentMeta: ResourceMeta = {
    ref: { scheme: "node", kind: "note", id: "parent" },
    title: "Parent",
    capabilities: ["open", "create", "read-content"],
  }
  const createdInputs: unknown[] = []
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [parentMeta] }
    },
    async get() {
      return { meta: parentMeta, content: null }
    },
    async create(input) {
      createdInputs.push(input)
      const meta: ResourceMeta = {
        ref: { scheme: "node", kind: "note", id: "root-created" },
        title: "Root",
        capabilities: ["open", "create", "read-content"],
      }
      return { meta, content: null }
    },
    async actions() {
      return [{ id: "create", label: "Create", requires: ["create"] }]
    },
    async invoke(ref, action) {
      assert.equal(action, "create")
      const meta: ResourceMeta = {
        ref: { scheme: "node", kind: "note", id: "child-created" },
        title: "Child",
        parent: ref,
        capabilities: ["open", "create", "read-content"],
      }
      return { meta, content: null }
    },
  })
  const fs = createResourceFileSystem()
  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const
  assert.equal((await fs.stat(corePlaceRef("notes"), ctx))?.capabilities.includes("create"), true)
  assert.equal(
    (await fs.actions(corePlaceRef("notes"), actionCtx)).some((action) => action.id === "create"),
    true,
  )

  const root = (await fs.invoke(corePlaceRef("notes"), "create", { title: "Root" }, actionCtx)) as {
    ref: { fileSystemId: string; fileId: string }
  }
  assert.deepEqual(resourceRefForFile(root.ref), {
    scheme: "node",
    kind: "note",
    id: "root-created",
  })
  assert.deepEqual(createdInputs, [{ title: "Root", kind: "note", parentId: null }])

  const child = (await fs.invoke(
    resourceFileRef(parentMeta.ref),
    "create",
    { title: "Child" },
    actionCtx,
  )) as { ref: { fileSystemId: string; fileId: string } }
  assert.deepEqual(resourceRefForFile(child.ref), {
    scheme: "node",
    kind: "note",
    id: "child-created",
  })
})

test("resource filesystem: recursive place entries preserve each descendant parent FileRef", async () => {
  const root: ResourceMeta = {
    ref: { scheme: "node", kind: "note", id: "root" },
    title: "Root",
    capabilities: ["open", "read-content"],
  }
  const child: ResourceMeta = {
    ref: { scheme: "node", kind: "note", id: "child" },
    title: "Child",
    parent: root.ref,
    capabilities: ["open", "read-content"],
  }
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [root, child] }
    },
    async get(ref) {
      const meta = ref.id === child.ref.id ? child : root
      return { meta, content: null }
    },
    async actions() {
      return []
    },
    async invoke() {
      throw new Error("unsupported")
    },
  })
  const fs = createResourceFileSystem()
  const page = await fs.readDirectory(
    corePlaceRef("notes"),
    { actor: "ui", permissions: [], intent: "directory" },
    { recursive: true },
  )
  const rootEntry = page.entries.find(
    (entry) => entry.target.fileId === resourceFileRef(root.ref).fileId,
  )
  const childEntry = page.entries.find(
    (entry) => entry.target.fileId === resourceFileRef(child.ref).fileId,
  )

  assert.deepEqual(rootEntry?.parent, corePlaceRef("notes"))
  assert.deepEqual(childEntry?.parent, resourceFileRef(root.ref))
  assert.deepEqual(rootEntry?.file?.ref, rootEntry?.target)
  assert.deepEqual(childEntry?.file?.ref, childEntry?.target)
})

test("resource filesystem: readMany delegates ordered node reads to one resource source batch", async () => {
  const metas: ResourceMeta[] = ["first", "second"].map((id) => ({
    ref: { scheme: "node", kind: "note", id },
    title: id,
    capabilities: ["open", "read-content"],
  }))
  const batches: string[][] = []
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: metas }
    },
    async get() {
      throw new Error("batchable reads must not fan out through get")
    },
    async getMany(refs, access) {
      assert.equal(access.intent, "content")
      batches.push(refs.map((ref) => ref.id))
      return refs.map((ref) => {
        const meta = metas.find((candidate) => candidate.ref.id === ref.id)
        return meta
          ? {
              meta,
              content: {
                id: ref.id,
                kind: "note",
                title: meta.title,
                parentId: null,
                sortKey: ref.id,
                tags: [],
                createdAt: 1,
                updatedAt: 1,
                content: [],
              },
            }
          : null
      })
    },
    async actions() {
      return []
    },
    async invoke() {
      throw new Error("unsupported")
    },
  })
  const fs = createResourceFileSystem()
  const refs = [
    resourceFileRef(metas[1]!.ref),
    resourceFileRef({ scheme: "node", kind: "note", id: "missing" }),
    resourceFileRef(metas[0]!.ref),
  ]
  const values = await fs.readMany!(
    refs,
    {
      actor: "system",
      permissions: ["fs:read", "fs.notes:read"],
      intent: "content",
    },
    { encoding: "json", concurrency: 2 },
  )

  assert.deepEqual(batches, [["second", "missing", "first"]])
  assert.deepEqual(
    values.map((value) => (value?.data as { id?: string } | undefined)?.id ?? null),
    ["second", null, "first"],
  )
})

test("resource filesystem: statMany delegates ordered metadata to one resource source batch", async () => {
  const metas: ResourceMeta[] = ["first", "second"].map((id) => ({
    ref: { scheme: "node", kind: "thread", id },
    title: id,
    capabilities: ["open", "read-content"],
  }))
  const batches: string[][] = []
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: metas }
    },
    async get() {
      throw new Error("batchable metadata must not fan out through get")
    },
    async getMany(refs, access) {
      assert.equal(access.intent, "metadata")
      batches.push(refs.map((ref) => ref.id))
      return refs.map((ref) => {
        const meta = metas.find((candidate) => candidate.ref.id === ref.id)
        return meta ? { meta, content: null } : null
      })
    },
    async actions() {
      return []
    },
    async invoke() {
      throw new Error("unsupported")
    },
  })
  const fs = createResourceFileSystem()
  const refs = [
    resourceFileRef(metas[1]!.ref),
    resourceFileRef({ scheme: "node", kind: "thread", id: "missing" }),
    resourceFileRef(metas[0]!.ref),
  ]
  const values = await fs.statMany!(refs, ctx, { concurrency: 2 })

  assert.deepEqual(batches, [["second", "missing", "first"]])
  assert.deepEqual(
    values.map((value) => value?.name ?? null),
    ["second", null, "first"],
  )
})

test("resource filesystem: system panels are files under a core directory", async () => {
  const fs = createResourceFileSystem()
  const page = await fs.readDirectory(corePlaceRef("system"), ctx)
  const shell = page.entries.find((entry) => entry.target.fileId === panelFileRef("shell").fileId)
  assert.ok(shell)
  const file = await fs.stat(shell.target, ctx)
  assert.equal(file?.kind, "file")
  assert.equal(file?.mediaType, "application/vnd.ideall.shell+json")
  assert.equal(file?.properties?.tabKind, "shell")
  assert.equal(shell.properties?.navigationHidden, true)
  for (const legacyId of ["git", "database", "audio"]) {
    assert.equal(
      page.entries.some((entry) => entry.target.fileId === panelFileRef(legacyId).fileId),
      false,
      `${legacyId} should navigate through its mounted App FileSystem root`,
    )
  }
})

test("resource filesystem: management navigation targets real place roots", async () => {
  const fs = createResourceFileSystem()
  for (const [place, legacyPanel] of [
    ["subscriptions", "subscriptions"],
    ["bookmarks", "bookmarks"],
    ["files", "files"],
  ] as const) {
    const root = await fs.stat(corePlaceRef(place), ctx)
    assert.equal(root?.kind, "directory")
    assert.equal(root?.mediaType, "inode/directory")
    assert.equal(root?.properties?.place, place)
    assert.equal(root?.properties?.rootChild, true)

    const panel = await fs.stat(panelFileRef(legacyPanel), ctx)
    assert.equal(panel?.kind, "file")
    assert.equal(panel?.properties?.navigationHidden, true)
  }
  for (const panelId of ["trash", "apps"]) {
    const panel = await fs.stat(panelFileRef(panelId), ctx)
    assert.equal(panel?.properties?.navigationHidden, true, panelId)
  }
  for (const panelId of ["spaces", "tasks", "settings", "ai-settings"]) {
    const panel = await fs.stat(panelFileRef(panelId), ctx)
    assert.equal(panel?.properties?.navigationHidden, true, panelId)
  }
})

test("resource filesystem: AI threads are linked from Home while the legacy workspace root remains", async () => {
  const thread: ResourceMeta = {
    ref: { scheme: "node", kind: "thread", id: "thread-home" },
    title: "对话",
    capabilities: ["open", "read-content"],
  }
  registerResourceSource({
    scheme: "node",
    async list(query) {
      return { items: query.kinds?.includes("thread") ? [thread] : [] }
    },
    async get() {
      return { meta: thread, content: null }
    },
    async actions() {
      return []
    },
    async invoke() {
      throw new Error("unsupported")
    },
  })

  const fs = createResourceFileSystem()
  const home = await fs.readDirectory(corePlaceRef("home"), ctx)
  assert.ok(
    home.entries.some((entry) => entry.target.fileId === resourceFileRef(thread.ref).fileId),
  )
  for (const place of ["bookmarks", "files", "notes"] as const) {
    assert.ok(
      home.entries.some((entry) => entry.target.fileId === corePlaceRef(place).fileId),
      `Home should nest ${place}`,
    )
  }
  assert.equal((await fs.stat(corePlaceRef("workspace"), ctx))?.kind, "directory")
})

test("resource filesystem: legacy aggregate spaces and tasks panels stay readable but hidden", async () => {
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [] }
    },
    async get() {
      throw new Error("not found")
    },
    async actions() {
      return []
    },
    async invoke() {
      throw new Error("unsupported")
    },
  })
  const fs = createResourceFileSystem()
  const page = await fs.readDirectory(corePlaceRef("workspace"), ctx)

  assert.deepEqual(
    page.entries.slice(0, 2).map((entry) => entry.target),
    [panelFileRef("spaces"), panelFileRef("tasks")],
  )
  assert.equal((await fs.stat(panelFileRef("spaces"), ctx))?.properties?.tabKind, "agent-spaces")
  assert.equal((await fs.stat(panelFileRef("tasks"), ctx))?.properties?.tabKind, "agent-task-list")
  assert.equal((await fs.stat(panelFileRef("spaces"), ctx))?.properties?.panelLayout, "padded")
  assert.equal((await fs.stat(panelFileRef("tasks"), ctx))?.properties?.panelLayout, "padded")
  assert.equal(page.entries[0]?.properties?.navigationHidden, true)
  assert.equal(page.entries[1]?.properties?.navigationHidden, true)
})

test("resource filesystem: dynamic AI task panels use canonical workspace FileRefs", async () => {
  const fs = createResourceFileSystem()
  const ref = aiTasksPanelFileRef("ws /100%")
  assert.deepEqual(ref, {
    fileSystemId: "ideall.core",
    fileId: "panel:ai-tasks:ws%20%2F100%25",
  })
  assert.deepEqual(aiTasksPanelFileRef("ws /100%"), ref, "title is not part of panel identity")

  const panel = panelForFile(ref)
  assert.equal(panel?.tabKind, "ai-tasks")
  assert.deepEqual(panel?.params, { workspaceId: "ws /100%" })
  assert.deepEqual(panel?.properties, { workspaceId: "ws /100%" })

  const file = await fs.stat(ref, ctx)
  assert.equal(file?.properties?.workspaceId, "ws /100%")
  assert.deepEqual(file?.properties?.params, { workspaceId: "ws /100%" })
  assert.deepEqual((await fs.read(ref, ctx)).data, {
    id: "ai-tasks:ws%20%2F100%25",
    name: "任务",
    tabKind: "ai-tasks",
    module: "agent",
    layout: "fill",
    params: { workspaceId: "ws /100%" },
    properties: { workspaceId: "ws /100%" },
  })

  assert.equal(
    panelForFile({ fileSystemId: "ideall.core", fileId: "panel:ai-tasks:ws%2funsafe" }),
    null,
  )
  assert.equal(
    panelForFile({ fileSystemId: "ideall.core", fileId: "panel:ai-tasks:%not-encoded" }),
    null,
  )
  assert.throws(
    () => aiTasksPanelFileRef(" "),
    (error: unknown) => {
      return error instanceof FileSystemError && error.code === "invalid-input"
    },
  )
})

test("resource filesystem: legacy resource identity and root hierarchy are preserved", async () => {
  const rootMeta: ResourceMeta = {
    ref: { scheme: "node", kind: "note", id: "root-note" },
    title: "Root",
    capabilities: ["open", "preview", "edit", "move", "delete", "read-content"],
  }
  const childMeta: ResourceMeta = {
    ref: { scheme: "node", kind: "note", id: "child-note" },
    title: "Child",
    parent: rootMeta.ref,
    capabilities: rootMeta.capabilities,
  }
  const provider: ResourceSourceProvider = {
    scheme: "node",
    async list(query) {
      return { items: query.parent ? [childMeta] : [rootMeta, childMeta] }
    },
    async get(ref) {
      const meta = ref.id === "root-note" ? rootMeta : childMeta
      return {
        meta,
        content: {
          id: ref.id,
          kind: "note",
          parentId: ref.id === "root-note" ? null : "root-note",
          sortKey: "a",
          title: meta.title,
          tags: [],
          createdAt: 1,
          updatedAt: 1,
          content: [],
        },
      }
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
  }
  registerResourceSource(provider)
  const fs = createResourceFileSystem()
  const roots = await fs.readDirectory(corePlaceRef("notes"), ctx)
  assert.deepEqual(
    roots.entries.slice(0, 2).map((entry) => [entry.name, entry.file?.kind, entry.target.fileId]),
    [
      ["文件", "file", "panel:notes"],
      ["Root", "directory", resourceFileRef(rootMeta.ref).fileId],
    ],
  )
  assert.equal(roots.entries[0]?.properties?.navigationHidden, true)
  assert.equal(
    roots.entries.find((entry) => entry.target.fileId.startsWith("resource:"))?.properties
      ?.preferredEngine,
    "ideall.note",
  )
  const noteEntries = roots.entries.filter((entry) => entry.target.fileId.startsWith("resource:"))
  assert.equal(noteEntries.length, 1, "place root only lists top-level notes")
  assert.deepEqual(resourceRefForFile(noteEntries[0].target), rootMeta.ref)
  const rootFile = await fs.stat(resourceFileRef(rootMeta.ref), ctx)
  assert.equal(rootFile?.kind, "directory")
  assert.equal(rootFile?.mediaType, "application/vnd.ideall.note+json")
  const children = await fs.readDirectory(resourceFileRef(rootMeta.ref), ctx)
  assert.equal(children.entries.length, 1)
  assert.deepEqual(resourceRefForFile(children.entries[0].target), childMeta.ref)
  assert.deepEqual(children.entries[0].parent, resourceFileRef(rootMeta.ref))
})

test("resource filesystem: stat normalizes legacy not-found errors to null", async () => {
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [] }
    },
    async get() {
      throw new ResourceSourceError("not-found", "legacy provider detail")
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
  })
  const fs = createResourceFileSystem()
  const missing = await fs.stat(
    resourceFileRef({ scheme: "node", kind: "file", id: "missing" }),
    ctx,
  )
  assert.equal(missing, null)
})

test("resource filesystem: bookmark directory links share one file identity across scenes", async () => {
  const meta: ResourceMeta = {
    ref: { scheme: "node", kind: "bookmark", id: "bookmark-1" },
    title: "Example",
    capabilities: ["open", "preview", "navigate"],
  }
  registerResourceSource({
    scheme: "node",
    async list(query) {
      return { items: query.kinds?.includes("bookmark") ? [meta] : [] }
    },
    async get() {
      return {
        meta,
        content: {
          id: "bookmark-1",
          kind: "bookmark",
          parentId: null,
          sortKey: "a",
          title: "Example",
          tags: [],
          createdAt: 1,
          updatedAt: 1,
          content: { url: "https://example.com", description: "", favicon: "" },
        },
      }
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
  })
  const fs = createResourceFileSystem()
  const [bookmarks, browser] = await Promise.all([
    fs.readDirectory(corePlaceRef("bookmarks"), ctx),
    fs.readDirectory(corePlaceRef("browser"), ctx),
  ])
  const bookmarksTarget = bookmarks.entries.find((entry) =>
    entry.target.fileId.startsWith("resource:"),
  )
  const browserTarget = browser.entries.find((entry) => entry.target.fileId.startsWith("resource:"))
  assert.deepEqual(browserTarget?.target, bookmarksTarget?.target)
  assert.equal(browserTarget?.properties?.preferredEngine, "ideall.browser")
})

test("resource filesystem: directory entry ids survive provider reordering", async () => {
  const metas: ResourceMeta[] = [
    {
      ref: { scheme: "node", kind: "note", id: "first" },
      title: "First",
      capabilities: ["open", "read-content"],
    },
    {
      ref: { scheme: "node", kind: "note", id: "second" },
      title: "Second",
      capabilities: ["open", "read-content"],
    },
  ]
  let reversed = false
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: reversed ? [...metas].reverse() : metas }
    },
    async get(ref) {
      const meta = metas.find((item) => item.ref.id === ref.id)
      return meta ? { meta, content: { id: ref.id } } : null
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
  })
  const fs = createResourceFileSystem()
  const first = await fs.readDirectory(corePlaceRef("notes"), ctx)
  reversed = true
  const second = await fs.readDirectory(corePlaceRef("notes"), ctx)
  const ids = (entries: typeof first.entries) =>
    Object.fromEntries(entries.map((entry) => [entry.target.fileId, entry.entryId]))

  assert.deepEqual(ids(second.entries), ids(first.entries))
})

test("resource filesystem: range reads preserve version and expectedVersion rejects stale writes", async () => {
  let meta: ResourceMeta = {
    ref: { scheme: "node", kind: "file", id: "bytes" },
    title: "bytes.bin",
    updatedAt: 7,
    capabilities: ["open", "read-blob", "edit"],
  }
  const actors: string[] = []
  const mutationVersions: Array<string | null | undefined> = []
  let writes = 0
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [meta] }
    },
    async get() {
      return {
        meta,
        content: {
          id: "bytes",
          kind: "file",
          parentId: null,
          sortKey: "a",
          title: "bytes.bin",
          tags: ["fixture"],
          createdAt: 2,
          updatedAt: 7,
          blobRef: { mime: "application/octet-stream", size: 4 },
          content: null,
        },
      }
    },
    async actions() {
      return []
    },
    async invoke(_ref, action, _input, access) {
      actors.push(access.actor)
      if (action === "read-blob") {
        return { mime: "application/octet-stream", size: 4, base64: "AQIDBA==" }
      }
      if (action === "write-blob") {
        writes++
        mutationVersions.push(access.expectedVersion)
        meta = { ...meta, updatedAt: (meta.updatedAt ?? 0) + 1 }
        return {
          meta,
          content: {
            id: "bytes",
            kind: "file",
            parentId: null,
            sortKey: "a",
            title: "bytes.bin",
            tags: ["fixture"],
            createdAt: 2,
            updatedAt: meta.updatedAt,
            blobRef: { mime: "application/octet-stream", size: 4 },
            content: null,
          },
        }
      }
      return null
    },
  })
  const fs = createResourceFileSystem()
  const ref = resourceFileRef(meta.ref)
  const file = await fs.stat(ref, ctx)
  assert.equal(file?.createdAt, 2)
  assert.deepEqual(file?.properties?.tags, ["fixture"])
  const result = await fs.read(ref, { ...ctx, intent: "content" }, { range: { start: 1, end: 3 } })
  assert.deepEqual(result.data, {
    mime: "application/octet-stream",
    size: 2,
    base64: "AgM=",
  })
  assert.equal(result.size, 2)
  assert.equal(result.version, "7")

  await assert.rejects(
    fs.write(
      ref,
      { data: "next", expectedVersion: "6" },
      { actor: "system", permissions: ["fs:write"], intent: "write" },
    ),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.equal(writes, 0)

  const written = await fs.write(
    ref,
    { data: "next", expectedVersion: "7" },
    { actor: "system", permissions: ["fs:write"], intent: "write" },
  )
  assert.equal(written.version, "8")
  assert.equal(writes, 1)
  assert.deepEqual(mutationVersions, ["7"])
  assert.equal(actors.at(-1), "agent", "system is never promoted to the resource source ui actor")
})

test("resource filesystem: writes return the committed action record without a post-commit stat", async () => {
  const metas = new Map<string, ResourceMeta>([
    [
      "file",
      {
        ref: { scheme: "node", kind: "file", id: "committed-file" },
        title: "before.txt",
        updatedAt: 1,
        capabilities: ["open", "read-blob", "edit"],
      },
    ],
    [
      "note",
      {
        ref: { scheme: "node", kind: "note", id: "committed-note" },
        title: "Before",
        updatedAt: 1,
        capabilities: ["open", "read-content", "edit"],
      },
    ],
  ])
  let gets = 0
  const actions: string[] = []
  const record = (ref: ResourceRef): ResourceRecord => {
    const meta = metas.get(ref.kind)
    assert.ok(meta)
    return {
      meta,
      content:
        ref.kind === "file"
          ? {
              id: ref.id,
              kind: "file",
              parentId: null,
              sortKey: "a0",
              title: meta.title,
              tags: [],
              createdAt: 1,
              updatedAt: meta.updatedAt,
              blobRef: { mime: "text/plain", size: 4 },
              content: null,
            }
          : {
              id: ref.id,
              kind: "note",
              parentId: null,
              sortKey: "a1",
              title: meta.title,
              tags: [],
              createdAt: 1,
              updatedAt: meta.updatedAt,
              content: [],
            },
    }
  }
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [...metas.values()] }
    },
    async get(ref) {
      gets++
      return record(ref)
    },
    async actions() {
      return []
    },
    async invoke(ref, action) {
      actions.push(action)
      const current = metas.get(ref.kind)
      assert.ok(current)
      metas.set(ref.kind, {
        ...current,
        title: ref.kind === "file" ? "after.txt" : "After",
        updatedAt: (current.updatedAt ?? 0) + 1,
      })
      return record(ref)
    },
  })
  const fs = createResourceFileSystem()
  const writeCtx = { actor: "system", permissions: ["fs:write"], intent: "write" } as const

  const file = await fs.write(
    resourceFileRef(metas.get("file")!.ref),
    { data: "next", expectedVersion: "1" },
    writeCtx,
  )
  const note = await fs.write(
    resourceFileRef(metas.get("note")!.ref),
    { data: { title: "After" }, expectedVersion: "1" },
    writeCtx,
  )

  assert.deepEqual(actions, ["write-blob", "edit"])
  assert.equal(gets, 2, "each write performs only its preflight get")
  assert.deepEqual(
    [file.name, file.version, note.name, note.version],
    ["after.txt", "2", "After", "2"],
  )
})

test("resource filesystem: rejects malformed or wrong-target committed write records", async () => {
  const meta: ResourceMeta = {
    ref: { scheme: "node", kind: "note", id: "committed-contract" },
    title: "Before",
    updatedAt: 1,
    capabilities: ["open", "read-content", "edit"],
  }
  let invocation = 0
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [meta] }
    },
    async get() {
      return { meta, content: [] }
    },
    async actions() {
      return []
    },
    async invoke() {
      invocation++
      if (invocation === 1) return { updated: true }
      return {
        meta: {
          ...meta,
          ref: { ...meta.ref, id: "different-target" },
        },
        content: [],
      }
    },
  })
  const fs = createResourceFileSystem()
  const ref = resourceFileRef(meta.ref)
  const writeCtx = { actor: "system", permissions: ["fs:write"], intent: "write" } as const

  for (const expectedInvocation of [1, 2]) {
    await assert.rejects(
      fs.write(ref, { data: { title: "After" }, expectedVersion: "1" }, writeCtx),
      (error) => error instanceof FileSystemError && error.code === "unsupported",
    )
    assert.equal(invocation, expectedInvocation)
  }
})

test("resource filesystem: concurrent writes atomically enforce a shared expectedVersion", async () => {
  let meta: ResourceMeta = {
    ref: { scheme: "node", kind: "file", id: "concurrent" },
    title: "concurrent.txt",
    updatedAt: 1,
    capabilities: ["open", "read-blob", "edit"],
  }
  let content = "base"
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [meta] }
    },
    async get() {
      return {
        meta,
        content: {
          id: "concurrent",
          kind: "file",
          parentId: null,
          sortKey: "a",
          title: meta.title,
          tags: [],
          createdAt: 1,
          updatedAt: meta.updatedAt,
          blobRef: { mime: "text/plain", size: content.length },
          content: null,
        },
      }
    },
    async actions() {
      return []
    },
    async invoke(_ref, action, input) {
      assert.equal(action, "write-blob")
      await new Promise((resolve) => setTimeout(resolve, 5))
      const next = input as { content: string }
      content = next.content
      meta = { ...meta, updatedAt: (meta.updatedAt ?? 0) + 1 }
      return {
        meta,
        content: {
          id: "concurrent",
          kind: "file",
          parentId: null,
          sortKey: "a",
          title: meta.title,
          tags: [],
          createdAt: 1,
          updatedAt: meta.updatedAt,
          blobRef: { mime: "text/plain", size: content.length },
          content: null,
        },
      }
    },
  })
  const fs = createResourceFileSystem()
  const ref = resourceFileRef(meta.ref)
  const writeCtx = { actor: "system", permissions: ["fs:write"], intent: "write" } as const
  const results = await Promise.allSettled(
    ["first", "second"].map(async (candidate) => {
      await fs.write(ref, { data: candidate, expectedVersion: "1" }, writeCtx)
      return candidate
    }),
  )
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<string> => result.status === "fulfilled",
  )
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )

  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.ok(rejected[0].reason instanceof FileSystemError)
  assert.equal(rejected[0].reason.code, "conflict")
  assert.equal(content, fulfilled[0].value)
  assert.equal(meta.updatedAt, 2)
})

test("resource filesystem: thread mutations wait for the Agent tasks lock before reaching the source", async () => {
  const metas = new Map<string, ResourceMeta>(
    ["write-thread", "delete-thread"].map((id) => [
      id,
      {
        ref: { scheme: "node", kind: "thread", id },
        title: id,
        updatedAt: 1,
        capabilities: ["open", "edit", "delete"],
      },
    ]),
  )
  const sourceCalls: string[] = []
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [...metas.values()] }
    },
    async get(ref) {
      sourceCalls.push(`get:${ref.id}`)
      const meta = metas.get(ref.id)
      return meta ? { meta, content: null } : null
    },
    async actions() {
      return []
    },
    async invoke(ref, action) {
      sourceCalls.push(`invoke:${ref.id}:${action}`)
      if (action !== "edit") return null
      const current = metas.get(ref.id)
      assert.ok(current)
      const meta = { ...current, updatedAt: (current.updatedAt ?? 0) + 1 }
      metas.set(ref.id, meta)
      return { meta, content: null }
    },
  })
  const fs = createResourceFileSystem()
  const writeRef = resourceFileRef(metas.get("write-thread")!.ref)
  const deleteRef = resourceFileRef(metas.get("delete-thread")!.ref)
  const lockEntered = deferred()
  const releaseLock = deferred()
  const tasksLock = withFileWriteLock(AGENT_TASKS_FILE_REF, async () => {
    lockEntered.resolve()
    await releaseLock.promise
  })
  await lockEntered.promise

  const write = fs.write(
    writeRef,
    { data: { title: "Updated" }, expectedVersion: "1" },
    { actor: "ui", permissions: [], intent: "write" },
  )
  const remove = fs.invoke(
    deleteRef,
    "delete",
    undefined,
    { actor: "ui", permissions: [], intent: "action" },
    { expectedVersion: "1" },
  )
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(sourceCalls, [], "queued thread mutations must not touch the source")

  releaseLock.resolve()
  await Promise.all([tasksLock, write, remove])
  assert.deepEqual(sourceCalls, [
    "get:write-thread",
    "invoke:write-thread:edit",
    "invoke:delete-thread:delete",
  ])
})

test("resource filesystem: source mutation conflicts remain FileSystem conflicts", async () => {
  const meta: ResourceMeta = {
    ref: { scheme: "node", kind: "note", id: "cas-note" },
    title: "CAS note",
    updatedAt: 3,
    capabilities: ["open", "edit", "delete"],
  }
  const mutations: Array<{ action: string; expectedVersion?: string | null }> = []
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [meta] }
    },
    async get() {
      return {
        meta,
        content: {
          id: meta.ref.id,
          kind: "note",
          title: meta.title,
          parentId: null,
          sortKey: "a0",
          tags: [],
          createdAt: 1,
          updatedAt: meta.updatedAt,
          content: [],
        },
      }
    },
    async actions() {
      return []
    },
    async invoke(_ref, action, _input, access) {
      mutations.push({ action, expectedVersion: access.expectedVersion })
      throw new ResourceSourceError("conflict", "injected mutation race")
    },
  })
  const fs = createResourceFileSystem()
  const ref = resourceFileRef(meta.ref)

  await assert.rejects(
    fs.write(
      ref,
      { data: { title: "stale" } },
      { actor: "system", permissions: ["fs:write"], intent: "write" },
    ),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  await assert.rejects(
    fs.invoke(
      ref,
      "delete",
      null,
      {
        actor: "system",
        permissions: ["fs:write"],
        intent: "action",
      },
      { expectedVersion: "3" },
    ),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.deepEqual(mutations, [
    { action: "edit", expectedVersion: "3" },
    { action: "delete", expectedVersion: "3" },
  ])
})

test("resource filesystem: engine access is scoped to its active file", async () => {
  const meta: ResourceMeta = {
    ref: { scheme: "node", kind: "file", id: "active" },
    title: "active.txt",
    updatedAt: 1,
    capabilities: ["open", "read-blob", "edit", "delete"],
  }
  const actors: string[] = []
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [meta] }
    },
    async get() {
      return {
        meta,
        content: {
          id: "active",
          kind: "file",
          blobRef: { mime: "text/plain", size: 4 },
        },
      }
    },
    async actions() {
      return [{ id: "delete", label: "Delete", destructive: true }]
    },
    async invoke(_ref, _action, _input, access) {
      actors.push(access.actor)
      return {
        meta,
        content: {
          id: "active",
          kind: "file",
          parentId: null,
          sortKey: "a",
          title: "active.txt",
          tags: [],
          createdAt: 1,
          updatedAt: meta.updatedAt,
          blobRef: { mime: "text/plain", size: 4 },
          content: null,
        },
      }
    },
  })
  const fs = createResourceFileSystem()
  const ref = resourceFileRef(meta.ref)
  await fs.write(
    ref,
    { data: "next" },
    { actor: "engine", permissions: [], activeFile: ref, intent: "write" },
  )
  assert.equal(actors.at(-1), "ui")

  await assert.rejects(
    fs.write(
      ref,
      { data: "blocked" },
      {
        actor: "engine",
        permissions: [],
        activeFile: resourceFileRef({ scheme: "node", kind: "file", id: "other" }),
        intent: "write",
      },
    ),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  await assert.rejects(
    fs.invoke(ref, "delete", null, {
      actor: "engine",
      permissions: [],
      activeFile: ref,
      intent: "action",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  await assert.rejects(
    fs.invoke(ref, "delete", null, {
      actor: "system",
      permissions: [],
      intent: "action",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
})

test("resource filesystem: watch is advertised only for watchable targets", async () => {
  const meta: ResourceMeta = {
    ref: { scheme: "node", kind: "note", id: "watched" },
    title: "Watched",
    capabilities: ["open", "read-content"],
  }
  let notifySource: (() => void) | undefined
  let watchedId: string | undefined
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [meta] }
    },
    async get() {
      return { meta, content: { id: "watched" } }
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
    watch(query, _access, notify) {
      watchedId = query.id
      notifySource = notify
      return { dispose() {} }
    },
  })
  const fs = createResourceFileSystem()
  const ref = resourceFileRef(meta.ref)
  assert.equal((await fs.stat(corePlaceRef("home"), ctx))?.capabilities.includes("watch"), true)
  assert.equal((await fs.stat(corePlaceRef("notes"), ctx))?.capabilities.includes("watch"), true)
  assert.equal((await fs.stat(ref, ctx))?.capabilities.includes("watch"), true)

  let events = 0
  const handle = fs.watch?.(ref, { ...ctx, intent: "watch" }, () => events++)
  assert.ok(handle)
  assert.equal(watchedId, "watched")
  notifySource?.()
  assert.equal(events, 1)
})

test("resource filesystem: place watch preserves the changed child ref", () => {
  const changed: ResourceMeta = {
    ref: { scheme: "node", kind: "thread", id: "changed-thread" },
    title: "Changed thread",
    capabilities: ["open", "read-content"],
  }
  let notifySource: ((event?: { ref?: ResourceMeta["ref"] }) => void) | undefined
  registerResourceSource({
    scheme: "node",
    async list() {
      return { items: [changed] }
    },
    async get() {
      return { meta: changed, content: { id: changed.ref.id } }
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
    watch(_query, _access, notify) {
      notifySource = notify
      return { dispose() {} }
    },
  })
  const fs = createResourceFileSystem()
  const homeRef = corePlaceRef("home")
  const events: unknown[] = []
  const handle = fs.watch?.(homeRef, { ...ctx, intent: "watch" }, (event) => events.push(event))
  assert.ok(handle)

  notifySource?.({ ref: changed.ref })

  assert.deepEqual(events, [
    {
      type: "changed",
      ref: homeRef,
      changes: [{ type: "changed", ref: resourceFileRef(changed.ref) }],
    },
  ])
})
