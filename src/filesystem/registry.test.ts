import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { DIRECTORY_MEDIA_TYPE, type FileRef, type IdeallFile } from "@protocol/file-system"
import {
  clearFileSystemsForTest,
  FileSystemRegistry,
  getFileSystem,
  registerFileSystem,
} from "./registry"
import {
  FileSystemError,
  type FileSystemAccessContext,
  type FileSystemProvider,
  type FileSystemWatchEvent,
} from "./types"

const ctx: FileSystemAccessContext = { actor: "ui", permissions: [] }

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

test("default filesystem registry: 提供渐进集成用的全局门面", () => {
  const fs = provider("global.local")
  const dispose = registerFileSystem(fs)
  assert.equal(getFileSystem("global.local"), fs)
  dispose()
  assert.equal(getFileSystem("global.local"), null)
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
    ],
    ctx,
    { encoding: "text" },
  )
  assert.deepEqual(
    values.map((value) => value?.data),
    ["first:a", "second:b", "first:c"],
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
  fs.read = async (ref) => {
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
  const refs = ["a", "b", "missing", "c", "d"].map((fileId) => ({
    fileSystemId: "batch.fallback",
    fileId,
  }))
  const values = await registry.readMany(refs, ctx, { concurrency: 2 })
  assert.deepEqual(
    values.map((value) => value?.data ?? null),
    ["a", "b", null, "c", "d"],
  )
  assert.equal(maxActive, 2)

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
  await assert.rejects(
    () => registry.readMany(refs, ctx, { concurrency: 0 }),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
})
