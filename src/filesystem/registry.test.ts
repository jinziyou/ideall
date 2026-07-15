import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import {
  DIRECTORY_MEDIA_TYPE,
  type DirectoryEntry,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import {
  clearFileSystemsForTest,
  FileSystemRegistry,
  getFileSystem,
  invokeFileAction,
  registerFileSystem,
  statFiles,
} from "./registry"
import {
  FileSystemError,
  type DirectoryPage,
  type FileSystemAccessContext,
  type FileSystemProvider,
  type FileSystemWatchEvent,
  type FileReadResult,
} from "./types"

const ctx: FileSystemAccessContext = { actor: "ui", permissions: [] }

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function metadata(ref: FileRef, name = ref.fileId): IdeallFile {
  return {
    ref,
    kind: "file",
    name,
    mediaType: "text/plain",
    capabilities: ["read"],
    source: { kind: "local", id: ref.fileSystemId },
  }
}

function directoryEntry(parent: FileRef, target: FileRef, entryId = target.fileId): DirectoryEntry {
  return {
    entryId,
    parent,
    target,
    name: target.fileId,
    kind: "child",
    file: metadata(target),
  }
}

function provider(fileSystemId: string, sourceId = fileSystemId): FileSystemProvider {
  const root: FileRef = { fileSystemId, fileId: "root" }
  const file: IdeallFile = {
    ref: root,
    kind: "directory",
    name: fileSystemId,
    mediaType: DIRECTORY_MEDIA_TYPE,
    capabilities: ["read-directory"],
    source: { kind: "local", id: sourceId },
  }
  return {
    descriptor: {
      fileSystemId,
      name: fileSystemId,
      root,
      source: file.source,
    },
    async stat(ref, access) {
      assert.equal(access, ctx)
      return ref.fileId === "root" ? file : null
    },
    async readDirectory(ref, access) {
      assert.equal(ref, root)
      assert.equal(access, ctx)
      return { entries: [] }
    },
    async read(ref, access, options) {
      assert.equal(ref, root)
      assert.equal(access, ctx)
      return { data: options?.encoding ?? "binary", mediaType: "application/octet-stream" }
    },
    async write(ref, input, access) {
      assert.equal(ref, root)
      assert.deepEqual(input, { data: "next" })
      assert.equal(access, ctx)
      return file
    },
    async actions(ref, access) {
      assert.equal(ref, root)
      assert.equal(access, ctx)
      return [{ id: "open", label: "打开", kind: "display" }]
    },
    async invoke(ref, action, input, access) {
      assert.equal(ref, root)
      assert.equal(action, "open")
      assert.deepEqual(input, { via: "test" })
      assert.equal(access, ctx)
      return "ok"
    },
    watch(ref, access, notify) {
      assert.equal(ref, root)
      assert.equal(access, ctx)
      notify({ type: "changed", ref })
      return { dispose: () => undefined }
    },
  }
}

afterEach(clearFileSystemsForTest)

test("filesystem registry: 按实例 id 分派全部文件系统操作", async () => {
  const registry = new FileSystemRegistry()
  const fs = provider("local.notes")
  const ref = fs.descriptor.root
  let eventType = ""
  const unregister = registry.register(fs)

  assert.equal(registry.get("local.notes"), fs)
  assert.equal((await registry.stat(ref, ctx))?.name, "local.notes")
  assert.deepEqual(await registry.readDirectory(ref, ctx), { entries: [] })
  assert.equal((await registry.read(ref, ctx, { encoding: "text" })).data, "text")
  assert.equal((await registry.write(ref, { data: "next" }, ctx)).ref, ref)
  assert.deepEqual(await registry.actions(ref, ctx), [
    { id: "open", label: "打开", kind: "display" },
  ])
  assert.equal(await registry.invoke(ref, "open", { via: "test" }, ctx), "ok")
  assert.ok(registry.watch(ref, ctx, (event) => (eventType = event.type)))
  assert.equal(eventType, "changed")

  unregister()
  assert.equal(registry.get("local.notes"), null)
})

test("filesystem registry: action invoke options reach the provider without breaking legacy calls", async () => {
  const fs = provider("action.options")
  const received: unknown[] = []
  fs.invoke = async (_ref, _action, _input, _ctx, options) => {
    received.push(options)
    return options?.expectedVersion ?? null
  }
  const unregister = registerFileSystem(fs)

  assert.equal(
    await invokeFileAction(fs.descriptor.root, "mutate", { value: 1 }, ctx, {
      expectedVersion: "v1",
    }),
    "v1",
  )
  assert.equal(await invokeFileAction(fs.descriptor.root, "mutate", { value: 2 }, ctx), null)
  assert.deepEqual(received, [{ expectedVersion: "v1" }, undefined])

  unregister()
})

test("filesystem registry: 同类来源可注册多个实例，重复实例被拒收", () => {
  const registry = new FileSystemRegistry()
  registry.register(provider("local.one", "indexed-db"))
  registry.register(provider("local.two", "indexed-db"))

  assert.deepEqual(
    registry.list().map((item) => item.descriptor.fileSystemId),
    ["local.one", "local.two"],
  )
  assert.throws(
    () => registry.register(provider("local.one")),
    (error) => error instanceof FileSystemError && error.code === "already-exists",
  )
})

test("filesystem registry: provider 变更可订阅且批处理只通知最终状态", () => {
  const registry = new FileSystemRegistry()
  const snapshots: string[][] = []
  registry.subscribe(() => {
    snapshots.push(registry.list().map((item) => item.descriptor.fileSystemId))
  })

  const first = registry.register(provider("runtime.one"))
  assert.equal(registry.revision(), 1)
  registry.batch(() => {
    first()
    registry.register(provider("runtime.two"))
  })

  assert.equal(registry.revision(), 2)
  assert.deepEqual(snapshots, [["runtime.one"], ["runtime.two"]])
})

test("filesystem registry: throwing observer cannot leak or block provider handles", () => {
  const registry = new FileSystemRegistry()
  let healthyCalls = 0
  registry.subscribe(() => {
    throw new Error("observer boom")
  })
  registry.subscribe(() => {
    healthyCalls += 1
  })

  const dispose = registry.register(provider("runtime.safe"))
  assert.equal(registry.get("runtime.safe")?.descriptor.fileSystemId, "runtime.safe")
  assert.equal(healthyCalls, 1)
  assert.doesNotThrow(dispose)
  assert.equal(registry.get("runtime.safe"), null)
  assert.equal(healthyCalls, 2)
})

test("filesystem registry: throwing file watcher is isolated from provider mutations", () => {
  const registry = new FileSystemRegistry()
  const fs = provider("runtime.watch-safe")
  const callbacks: Array<(event: FileSystemWatchEvent) => void> = []
  fs.watch = (ref, access, notify) => {
    assert.equal(access, ctx)
    callbacks.push(notify)
    return { dispose: () => undefined }
  }
  registry.register(fs)
  registry.watch(fs.descriptor.root, ctx, () => {
    throw new Error("watcher boom")
  })
  let healthyCalls = 0
  registry.watch(fs.descriptor.root, ctx, () => {
    healthyCalls += 1
  })

  assert.doesNotThrow(() => {
    for (const notify of callbacks) notify({ type: "changed", ref: fs.descriptor.root })
  })
  assert.equal(healthyCalls, 1)
})

test("filesystem registry: watch drops malformed and cyclic provider events", () => {
  const registry = new FileSystemRegistry()
  const fs = provider("runtime.watch-validation")
  let emit: ((event: FileSystemWatchEvent) => void) | undefined
  fs.watch = (_ref, _access, notify) => {
    emit = notify
    return { dispose: () => undefined }
  }
  registry.register(fs)
  const received: FileSystemWatchEvent[] = []
  registry.watch(fs.descriptor.root, ctx, (event) => received.push(event))

  const cyclic: FileSystemWatchEvent = {
    type: "changed",
    ref: fs.descriptor.root,
    changes: [],
  }
  ;(cyclic as unknown as { changes: FileSystemWatchEvent[] }).changes = [cyclic]
  const sparseChanges = new Array<FileSystemWatchEvent>(1)
  const malformed: unknown[] = [
    null,
    { type: "renamed", ref: fs.descriptor.root },
    { type: "changed", ref: { fileSystemId: "", fileId: "root" } },
    { type: "changed", ref: fs.descriptor.root, version: 2 },
    {
      type: "changed",
      ref: fs.descriptor.root,
      changes: [{ type: "changed", ref: { fileSystemId: "runtime.watch-validation" } }],
    },
    { type: "changed", ref: fs.descriptor.root, changes: sparseChanges },
    cyclic,
  ]

  for (const event of malformed) {
    assert.doesNotThrow(() => emit?.(event as FileSystemWatchEvent))
  }
  const sharedChange: FileSystemWatchEvent = {
    type: "created",
    ref: { fileSystemId: "runtime.watch-validation", fileId: "child" },
    newParent: fs.descriptor.root,
  }
  emit?.({
    type: "changed",
    ref: fs.descriptor.root,
    changes: [sharedChange, sharedChange],
  })

  assert.equal(received.length, 1)
  assert.equal(received[0]?.changes?.[0]?.type, "created")
  assert.equal(received[0]?.changes?.length, 2)
})

test("filesystem registry: watch rejects malformed provider handles", () => {
  const registry = new FileSystemRegistry()
  const fs = provider("runtime.watch-handle-validation")
  fs.watch = () => ({}) as unknown as ReturnType<NonNullable<FileSystemProvider["watch"]>>
  registry.register(fs)

  assert.throws(
    () => registry.watch(fs.descriptor.root, ctx, () => {}),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
})

test("filesystem registry: identical watches share one provider subscription until the last disposer", () => {
  const registry = new FileSystemRegistry()
  const fs = provider("runtime.watch-shared")
  let providerSubscriptions = 0
  let providerDisposals = 0
  let emit: ((event: FileSystemWatchEvent) => void) | undefined
  fs.watch = (_ref, _access, notify) => {
    providerSubscriptions += 1
    emit = notify
    return { dispose: () => providerDisposals++ }
  }
  registry.register(fs)
  let firstCalls = 0
  let secondCalls = 0
  const first = registry.watch(fs.descriptor.root, ctx, () => firstCalls++)
  const second = registry.watch(
    fs.descriptor.root,
    { ...ctx, permissions: [...ctx.permissions] },
    () => secondCalls++,
  )

  assert.ok(first)
  assert.ok(second)
  assert.equal(providerSubscriptions, 1)
  emit?.({ type: "changed", ref: fs.descriptor.root, version: "2" })
  assert.deepEqual([firstCalls, secondCalls], [1, 1])

  first.dispose()
  assert.equal(providerDisposals, 0)
  second.dispose()
  second.dispose()
  assert.equal(providerDisposals, 1)
})

test("filesystem registry: unregister automatically releases watches and rejects stale callbacks", () => {
  const registry = new FileSystemRegistry()
  const fs = provider("runtime.watch-unregister")
  let disposed = 0
  let emit: ((event: FileSystemWatchEvent) => void) | undefined
  fs.watch = (_ref, _access, notify) => {
    emit = notify
    return { dispose: () => disposed++ }
  }
  const unregister = registry.register(fs)
  let calls = 0
  const handle = registry.watch(fs.descriptor.root, ctx, () => calls++)
  assert.ok(handle)

  unregister()
  assert.equal(disposed, 1)
  emit?.({ type: "changed", ref: fs.descriptor.root })
  assert.equal(calls, 0)
  assert.doesNotThrow(() => handle.dispose())
  assert.equal(disposed, 1)
})

test("filesystem registry: replace invalidates the old generation before accepting new events", () => {
  const registry = new FileSystemRegistry()
  const oldProvider = provider("runtime.watch-replace")
  const nextProvider = provider("runtime.watch-replace")
  let oldDisposed = 0
  let oldEmit: ((event: FileSystemWatchEvent) => void) | undefined
  let nextEmit: ((event: FileSystemWatchEvent) => void) | undefined
  oldProvider.watch = (_ref, _access, notify) => {
    oldEmit = notify
    return { dispose: () => oldDisposed++ }
  }
  nextProvider.watch = (_ref, _access, notify) => {
    nextEmit = notify
    return { dispose: () => undefined }
  }
  registry.register(oldProvider)
  let oldCalls = 0
  registry.watch(oldProvider.descriptor.root, ctx, () => oldCalls++)

  registry.replace(nextProvider)
  assert.equal(oldDisposed, 1)
  assert.equal(registry.get(nextProvider.descriptor.fileSystemId), nextProvider)
  let nextCalls = 0
  registry.watch(nextProvider.descriptor.root, ctx, () => nextCalls++)
  oldEmit?.({ type: "changed", ref: oldProvider.descriptor.root, version: "old" })
  nextEmit?.({ type: "changed", ref: nextProvider.descriptor.root, version: "new" })
  assert.deepEqual([oldCalls, nextCalls], [0, 1])
})

test("filesystem registry: delayed scalar read rejects a retired provider result", async () => {
  const registry = new FileSystemRegistry()
  const oldProvider = provider("runtime.read-replace")
  const nextProvider = provider("runtime.read-replace")
  const started = deferred()
  const release = deferred()
  oldProvider.read = async () => {
    started.resolve()
    await release.promise
    return { data: "stale", mediaType: "text/plain" }
  }
  nextProvider.read = async () => ({ data: "current", mediaType: "text/plain" })
  registry.register(oldProvider)

  const pending = registry.read(oldProvider.descriptor.root, ctx, { encoding: "text" })
  await started.promise
  registry.replace(nextProvider)
  release.resolve()

  await assert.rejects(
    pending,
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  assert.equal(
    (await registry.read(nextProvider.descriptor.root, ctx, { encoding: "text" })).data,
    "current",
  )
})

test("filesystem registry: delayed scalar write cannot report retired-provider success", async () => {
  const registry = new FileSystemRegistry()
  const oldProvider = provider("runtime.write-replace")
  const nextProvider = provider("runtime.write-replace")
  const started = deferred()
  const release = deferred()
  let oldSideEffects = 0
  let nextWrites = 0
  oldProvider.write = async () => {
    started.resolve()
    await release.promise
    oldSideEffects += 1
    return {
      ref: oldProvider.descriptor.root,
      kind: "directory",
      name: "retired",
      mediaType: DIRECTORY_MEDIA_TYPE,
      capabilities: ["read-directory"],
      source: oldProvider.descriptor.source,
    }
  }
  nextProvider.write = async (ref) => {
    nextWrites += 1
    return {
      ref,
      kind: "directory",
      name: "current",
      mediaType: DIRECTORY_MEDIA_TYPE,
      capabilities: ["read-directory"],
      source: nextProvider.descriptor.source,
    }
  }
  registry.register(oldProvider)

  const pending = registry.write(oldProvider.descriptor.root, { data: "retired-write" }, ctx)
  await started.promise
  registry.replace(nextProvider)
  release.resolve()

  await assert.rejects(
    pending,
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  assert.equal(oldSideEffects, 1, "registry cannot roll back an external retired-provider write")
  assert.equal(
    (await registry.write(nextProvider.descriptor.root, { data: "current-write" }, ctx)).name,
    "current",
  )
  assert.equal(nextWrites, 1)
})

test("filesystem registry: replacement wins over a delayed retired-provider invoke error", async () => {
  const registry = new FileSystemRegistry()
  const oldProvider = provider("runtime.invoke-replace")
  const nextProvider = provider("runtime.invoke-replace")
  const started = deferred()
  const release = deferred()
  let oldSideEffects = 0
  oldProvider.invoke = async (ref) => {
    started.resolve()
    await release.promise
    oldSideEffects += 1
    throw new FileSystemError("permission-denied", "retired invoke failed", ref)
  }
  nextProvider.invoke = async () => "current"
  registry.register(oldProvider)

  const pending = registry.invoke(oldProvider.descriptor.root, "mutate", { value: 1 }, ctx)
  await started.promise
  registry.replace(nextProvider)
  release.resolve()

  await assert.rejects(
    pending,
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  assert.equal(oldSideEffects, 1, "registry cannot roll back an external retired-provider action")
  assert.equal(
    await registry.invoke(nextProvider.descriptor.root, "mutate", { value: 2 }, ctx),
    "current",
  )
})

test("filesystem registry: clear disposes all watches even when one provider disposer throws", () => {
  const registry = new FileSystemRegistry()
  const first = provider("runtime.watch-clear.first")
  const second = provider("runtime.watch-clear.second")
  let firstDisposed = 0
  let secondDisposed = 0
  first.watch = () => ({
    dispose() {
      firstDisposed += 1
      throw new Error("dispose boom")
    },
  })
  second.watch = () => ({ dispose: () => secondDisposed++ })
  registry.register(first)
  registry.register(second)
  registry.watch(first.descriptor.root, ctx, () => {})
  registry.watch(second.descriptor.root, ctx, () => {})

  assert.doesNotThrow(() => registry.clear())
  assert.deepEqual([firstDisposed, secondDisposed], [1, 1])
  assert.deepEqual(registry.list(), [])
})

test("filesystem registry: provider 根归属与未知实例均返回结构化错误", async () => {
  const registry = new FileSystemRegistry()
  const invalid = provider("local.bad")
  invalid.descriptor.root = { fileSystemId: "other", fileId: "root" }

  assert.throws(
    () => registry.register(invalid),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  await assert.rejects(
    () => registry.stat({ fileSystemId: "missing", fileId: "1" }, ctx),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
})

test("filesystem registry: stat/statMany/write fully validate IdeallFile output", async () => {
  const registry = new FileSystemRegistry()
  const fs = provider("metadata.output-validation")
  const ref = fs.descriptor.root
  const valid: IdeallFile = {
    ...metadata(ref),
    size: 0,
    createdAt: 1,
    updatedAt: 2,
    version: "3",
    properties: { safe: true },
  }
  registry.register(fs)

  fs.stat = async () => valid
  fs.statMany = async () => [valid]
  fs.write = async () => valid
  assert.equal((await registry.stat(ref, ctx))?.version, "3")
  assert.equal((await registry.statMany([ref], ctx))[0]?.size, 0)
  assert.equal((await registry.write(ref, { data: "valid" }, ctx)).updatedAt, 2)

  const malformed: unknown[] = [
    { ...valid, ref: { fileSystemId: ref.fileSystemId, fileId: "wrong" } },
    { ...valid, kind: "symlink" },
    { ...valid, name: 1 },
    { ...valid, mediaType: "" },
    { ...valid, capabilities: ["read", 1] },
    { ...valid, source: { kind: "builtin", id: "test" } },
    { ...valid, source: { kind: "local", id: "", readOnly: "yes" } },
    { ...valid, size: -1 },
    { ...valid, createdAt: Number.NaN },
    { ...valid, updatedAt: Number.POSITIVE_INFINITY },
    { ...valid, version: 4 },
    { ...valid, properties: [] },
  ]
  for (const value of malformed) {
    fs.stat = async () => value as IdeallFile
    await assert.rejects(
      () => registry.stat(ref, ctx),
      (error) => error instanceof FileSystemError && error.code === "unavailable",
    )
  }

  fs.statMany = async () => [{ ...valid, capabilities: "read" } as unknown as IdeallFile]
  await assert.rejects(
    () => registry.statMany([ref], ctx),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  fs.write = async () => ({ ...valid, source: null }) as unknown as IdeallFile
  await assert.rejects(
    () => registry.write(ref, { data: "invalid" }, ctx),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
})

test("filesystem registry: read/readMany validate complete FileReadResult output", async () => {
  const registry = new FileSystemRegistry()
  const fs = provider("read.output-validation")
  const ref = fs.descriptor.root
  registry.register(fs)

  fs.read = async () => ({
    data: undefined,
    mediaType: "application/octet-stream",
    size: 0,
    version: "1",
  })
  assert.equal((await registry.read(ref, ctx)).size, 0)

  const malformed: unknown[] = [
    null,
    {},
    { mediaType: "text/plain" },
    { data: "value", mediaType: 1 },
    { data: "value", mediaType: "" },
    { data: "value", mediaType: "text/plain", size: -1 },
    { data: "value", mediaType: "text/plain", size: Number.NaN },
    { data: "value", mediaType: "text/plain", version: 1 },
  ]
  for (const value of malformed) {
    fs.read = async () => value as FileReadResult
    await assert.rejects(
      () => registry.read(ref, ctx),
      (error) => error instanceof FileSystemError && error.code === "unavailable",
    )
  }

  fs.readMany = async () => [
    { data: "value", mediaType: "text/plain", size: Number.POSITIVE_INFINITY },
  ]
  await assert.rejects(
    () => registry.readMany([ref], ctx),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
})

test("filesystem registry: readDirectory validates pages, entries, snapshots, and parent scope", async () => {
  const registry = new FileSystemRegistry()
  const fs = provider("directory.output-validation")
  const ref = fs.descriptor.root
  const child: FileRef = { fileSystemId: ref.fileSystemId, fileId: "child" }
  const nestedParent: FileRef = { fileSystemId: ref.fileSystemId, fileId: "nested" }
  const entry = directoryEntry(ref, child)
  registry.register(fs)

  fs.readDirectory = async () => ({ entries: [entry], nextCursor: "next" })
  assert.equal((await registry.readDirectory(ref, ctx)).entries[0]?.target, child)

  const malformed: unknown[] = [
    null,
    { entries: "invalid" },
    { entries: new Array<DirectoryEntry>(1) },
    { entries: [{ ...entry, entryId: 1 }] },
    { entries: [{ ...entry, parent: nestedParent }] },
    { entries: [{ ...entry, target: { fileSystemId: "", fileId: "child" } }] },
    {
      entries: [
        entry,
        directoryEntry(ref, { fileSystemId: ref.fileSystemId, fileId: "other" }, entry.entryId),
      ],
    },
    {
      entries: [
        {
          ...entry,
          file: metadata({ fileSystemId: ref.fileSystemId, fileId: "wrong-snapshot" }),
        },
      ],
    },
    { entries: [entry], nextCursor: 1 },
  ]
  for (const page of malformed) {
    fs.readDirectory = async () => page as DirectoryPage
    await assert.rejects(
      () => registry.readDirectory(ref, ctx),
      (error) => error instanceof FileSystemError && error.code === "unavailable",
    )
  }

  fs.readDirectory = async () => ({
    entries: [
      directoryEntry(nestedParent, child, "shared"),
      directoryEntry(
        { fileSystemId: ref.fileSystemId, fileId: "other-parent" },
        { fileSystemId: ref.fileSystemId, fileId: "other-child" },
        "shared",
      ),
    ],
  })
  const recursive = await registry.readDirectory(ref, ctx, { recursive: true })
  assert.equal(recursive.entries[0]?.parent, nestedParent)
  assert.equal(recursive.entries[1]?.entryId, "shared")
})

test("default filesystem registry: 提供渐进集成用的全局门面", async () => {
  const fs = provider("global.local")
  const dispose = registerFileSystem(fs)
  assert.equal(getFileSystem("global.local"), fs)
  assert.equal((await statFiles([fs.descriptor.root], ctx))[0]?.name, "global.local")
  dispose()
  assert.equal(getFileSystem("global.local"), null)
})

test("filesystem registry: statMany groups by provider and restores input order", async () => {
  const registry = new FileSystemRegistry()
  const first = provider("metadata.first")
  const second = provider("metadata.second")
  const calls: Array<{ provider: string; ids: string[] }> = []
  first.statMany = async (refs) => {
    calls.push({ provider: "first", ids: refs.map((ref) => ref.fileId) })
    return refs.map((ref) => metadata(ref, `first:${ref.fileId}`))
  }
  second.statMany = async (refs) => {
    calls.push({ provider: "second", ids: refs.map((ref) => ref.fileId) })
    return refs.map((ref) =>
      ref.fileId === "missing" ? null : metadata(ref, `second:${ref.fileId}`),
    )
  }
  registry.register(first)
  registry.register(second)

  const values = await registry.statMany(
    [
      { fileSystemId: "metadata.first", fileId: "a" },
      { fileSystemId: "metadata.second", fileId: "missing" },
      { fileSystemId: "metadata.first", fileId: "c" },
      { fileSystemId: "metadata.first", fileId: "a" },
      { fileSystemId: "metadata.second", fileId: "d" },
      { fileSystemId: "metadata.second", fileId: "missing" },
    ],
    ctx,
  )
  assert.deepEqual(
    values.map((value) => value?.name ?? null),
    ["first:a", null, "first:c", "first:a", "second:d", null],
  )
  assert.deepEqual(calls, [
    { provider: "first", ids: ["a", "c"] },
    { provider: "second", ids: ["missing", "d"] },
  ])
})

test("filesystem registry: statMany fallback is bounded and only normalizes not-found", async () => {
  const registry = new FileSystemRegistry()
  const fs = provider("metadata.fallback")
  let active = 0
  let maxActive = 0
  const calls = new Map<string, number>()
  fs.stat = async (ref) => {
    calls.set(ref.fileId, (calls.get(ref.fileId) ?? 0) + 1)
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    try {
      if (ref.fileId === "missing") throw new FileSystemError("not-found", "missing", ref)
      return metadata(ref)
    } finally {
      active -= 1
    }
  }
  registry.register(fs)
  const refs = ["a", "b", "missing", "c", "d", "a"].map((fileId) => ({
    fileSystemId: "metadata.fallback",
    fileId,
  }))

  const values = await registry.statMany(refs, ctx, { concurrency: 2 })
  assert.deepEqual(
    values.map((value) => value?.name ?? null),
    ["a", "b", null, "c", "d", "a"],
  )
  assert.equal(maxActive, 2)
  assert.equal(calls.get("a"), 1)

  fs.stat = async (ref) => {
    throw new FileSystemError("permission-denied", "private", ref)
  }
  await assert.rejects(
    () => registry.statMany(refs, ctx, { concurrency: 2 }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
})

test("filesystem registry: statMany rejects malformed native batches and unsafe concurrency", async () => {
  const registry = new FileSystemRegistry()
  const fs = provider("metadata.invalid")
  const ref = { fileSystemId: "metadata.invalid", fileId: "one" }
  fs.statMany = async () => []
  registry.register(fs)

  await assert.rejects(
    () => registry.statMany([ref], ctx),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  fs.statMany = async () => new Array(1) as Array<null>
  await assert.rejects(
    () => registry.statMany([ref], ctx),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  fs.statMany = async () => [metadata({ fileSystemId: "metadata.invalid", fileId: "wrong" })]
  await assert.rejects(
    () => registry.statMany([ref], ctx),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  const overriddenMap = [metadata(ref)]
  Object.defineProperty(overriddenMap, "map", {
    value: () => [{ bypassed: true } as unknown as IdeallFile],
  })
  fs.statMany = async () => overriddenMap
  assert.equal((await registry.statMany([ref], ctx))[0]?.name, "one")

  let accessorReads = 0
  const stateful = new Array<IdeallFile>(1)
  Object.defineProperty(stateful, 0, {
    configurable: true,
    get() {
      accessorReads += 1
      if (accessorReads > 1) throw new Error("batch result was read more than once")
      return metadata(ref)
    },
  })
  fs.statMany = async () => stateful
  assert.equal((await registry.statMany([ref], ctx))[0]?.name, "one")
  assert.equal(accessorReads, 1)

  const throwing = new Array<IdeallFile>(1)
  Object.defineProperty(throwing, 0, {
    get() {
      throw new Error("provider getter failed")
    },
  })
  fs.statMany = async () => throwing
  await assert.rejects(
    () => registry.statMany([ref], ctx),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  await assert.rejects(
    () => registry.statMany([ref], ctx, { concurrency: 0 }),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
})

test("filesystem registry: batch refs are prevalidated, bounded, deduplicated, and expanded", async () => {
  const registry = new FileSystemRegistry()
  const fs = provider("batch.input-validation")
  const ref = fs.descriptor.root
  let statCalls = 0
  let readCalls = 0
  fs.statMany = async (refs) => {
    statCalls += 1
    assert.deepEqual(refs, [ref])
    return [metadata(ref)]
  }
  fs.readMany = async (refs) => {
    readCalls += 1
    assert.deepEqual(refs, [ref])
    return [{ data: "value", mediaType: "text/plain" }]
  }
  registry.register(fs)

  const repeated = Array.from({ length: 5_000 }, () => ref)
  const stats = await registry.statMany(repeated, ctx)
  const reads = await registry.readMany(repeated, ctx)
  assert.equal(stats.length, 5_000)
  assert.equal(reads.length, 5_000)
  assert.deepEqual(stats[4_999]?.ref, ref)
  assert.equal(reads[4_999]?.data, "value")
  assert.deepEqual([statCalls, readCalls], [1, 1])

  class StructuralRef {
    constructor(
      readonly fileSystemId: string,
      readonly fileId: string,
    ) {}
  }
  const structuralRef = new StructuralRef(ref.fileSystemId, ref.fileId) as FileRef
  const overriddenForEach = [structuralRef]
  overriddenForEach.forEach = () => {
    throw new Error("registry must not call caller-controlled forEach")
  }
  assert.equal((await registry.statMany(overriddenForEach, ctx))[0]?.name, "root")
  assert.equal((await registry.readMany(overriddenForEach, ctx))[0]?.data, "value")
  assert.equal((await registry.stat(structuralRef, ctx))?.name, "batch.input-validation")
  assert.deepEqual([statCalls, readCalls], [2, 2])

  const sparse = new Array<FileRef>(1)
  const malformed = [ref, { fileSystemId: "", fileId: "bad" }] as FileRef[]
  const excessive = Array.from({ length: 10_001 }, () => ref)
  const invalidBatches: unknown[] = [null, sparse, malformed, excessive]
  for (const refs of invalidBatches) {
    await assert.rejects(
      () => registry.statMany(refs as readonly FileRef[], ctx),
      (error) => error instanceof FileSystemError && error.code === "invalid-input",
    )
    await assert.rejects(
      () => registry.readMany(refs as readonly FileRef[], ctx),
      (error) => error instanceof FileSystemError && error.code === "invalid-input",
    )
  }
  assert.deepEqual([statCalls, readCalls], [2, 2])

  await assert.rejects(
    () => registry.stat({ fileSystemId: "", fileId: "bad" }, ctx),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  assert.throws(
    () => registry.watch({ fileSystemId: "batch.input-validation", fileId: "" }, ctx, () => {}),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
})

test("filesystem registry: statMany rejects results from a replaced provider generation", async () => {
  const registry = new FileSystemRegistry()
  const oldProvider = provider("metadata.replaced")
  const nextProvider = provider("metadata.replaced")
  const started = deferred()
  const release = deferred()
  oldProvider.statMany = async (refs) => {
    started.resolve()
    await release.promise
    return refs.map((ref) => metadata(ref, `stale:${ref.fileId}`))
  }
  nextProvider.statMany = async (refs) => refs.map((ref) => metadata(ref, `current:${ref.fileId}`))
  registry.register(oldProvider)
  const ref = { fileSystemId: "metadata.replaced", fileId: "one" }

  const pending = registry.statMany([ref], ctx)
  await started.promise
  registry.replace(nextProvider)
  release.resolve()

  await assert.rejects(
    pending,
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  assert.equal((await registry.statMany([ref], ctx))[0]?.name, "current:one")
})

test("filesystem registry: readMany groups by provider and restores input order", async () => {
  const registry = new FileSystemRegistry()
  const first = provider("batch.first")
  const second = provider("batch.second")
  const calls: Array<{ provider: string; ids: string[] }> = []
  first.readMany = async (refs) => {
    calls.push({ provider: "first", ids: refs.map((ref) => ref.fileId) })
    return refs.map((ref) => ({ data: `first:${ref.fileId}`, mediaType: "text/plain" }))
  }
  second.readMany = async (refs) => {
    calls.push({ provider: "second", ids: refs.map((ref) => ref.fileId) })
    return refs.map((ref) => ({ data: `second:${ref.fileId}`, mediaType: "text/plain" }))
  }
  registry.register(first)
  registry.register(second)

  const values = await registry.readMany(
    [
      { fileSystemId: "batch.first", fileId: "a" },
      { fileSystemId: "batch.second", fileId: "b" },
      { fileSystemId: "batch.first", fileId: "c" },
      { fileSystemId: "batch.first", fileId: "a" },
      { fileSystemId: "batch.second", fileId: "b" },
    ],
    ctx,
    { encoding: "text" },
  )
  assert.deepEqual(
    values.map((value) => value?.data),
    ["first:a", "second:b", "first:c", "first:a", "second:b"],
  )
  assert.deepEqual(calls, [
    { provider: "first", ids: ["a", "c"] },
    { provider: "second", ids: ["b"] },
  ])
})

test("filesystem registry: readMany rejects results from a replaced provider generation", async () => {
  const registry = new FileSystemRegistry()
  const oldProvider = provider("batch.replaced")
  const nextProvider = provider("batch.replaced")
  let markStarted!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  oldProvider.readMany = async (refs) => {
    markStarted()
    await gate
    return refs.map((ref) => ({ data: `stale:${ref.fileId}`, mediaType: "text/plain" }))
  }
  registry.register(oldProvider)

  const pending = registry.readMany([{ fileSystemId: "batch.replaced", fileId: "one" }], ctx)
  await started
  registry.replace(nextProvider)
  const rejected = assert.rejects(
    pending,
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  release()
  await rejected
})

test("filesystem registry: readMany fallback is bounded and only normalizes not-found", async () => {
  const registry = new FileSystemRegistry()
  const fs = provider("batch.fallback")
  let active = 0
  let maxActive = 0
  const calls = new Map<string, number>()
  fs.read = async (ref) => {
    calls.set(ref.fileId, (calls.get(ref.fileId) ?? 0) + 1)
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    try {
      if (ref.fileId === "missing") throw new FileSystemError("not-found", "missing", ref)
      return { data: ref.fileId, mediaType: "text/plain" }
    } finally {
      active -= 1
    }
  }
  registry.register(fs)
  const refs = ["a", "b", "missing", "c", "d", "a"].map((fileId) => ({
    fileSystemId: "batch.fallback",
    fileId,
  }))
  const values = await registry.readMany(refs, ctx, { concurrency: 2 })
  assert.deepEqual(
    values.map((value) => value?.data ?? null),
    ["a", "b", null, "c", "d", "a"],
  )
  assert.equal(maxActive, 2)
  assert.equal(calls.get("a"), 1)

  fs.read = async (ref) => {
    throw new FileSystemError("permission-denied", "private", ref)
  }
  await assert.rejects(
    () => registry.readMany(refs, ctx, { concurrency: 2 }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
})

test("filesystem registry: readMany rejects malformed native batches and unsafe concurrency", async () => {
  const registry = new FileSystemRegistry()
  const fs = provider("batch.invalid")
  fs.readMany = async () => []
  registry.register(fs)
  const refs = [{ fileSystemId: "batch.invalid", fileId: "one" }]

  await assert.rejects(
    () => registry.readMany(refs, ctx),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  fs.readMany = async () => new Array(1) as Array<null>
  await assert.rejects(
    () => registry.readMany(refs, ctx),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  const overriddenMap = [{ data: "valid", mediaType: "text/plain" }]
  Object.defineProperty(overriddenMap, "map", {
    value: () => [{ bypassed: true } as unknown as FileReadResult],
  })
  fs.readMany = async () => overriddenMap
  assert.equal((await registry.readMany(refs, ctx))[0]?.data, "valid")
  await assert.rejects(
    () => registry.readMany(refs, ctx, { concurrency: 0 }),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
})
