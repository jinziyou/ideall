import { test } from "node:test"
import assert from "node:assert/strict"
import { DIRECTORY_MEDIA_TYPE, type FileRef, type IdeallFile } from "@protocol/file-system"
import { CompositeRootFileSystem, mountFileSystem } from "./composite-root"
import { FileSystemRegistry } from "./registry"
import { FileSystemError, type FileSystemAccessContext, type FileSystemProvider } from "./types"

const ctx: FileSystemAccessContext = { actor: "ui", permissions: [] }

function provider(fileSystemId: string): FileSystemProvider {
  const root: FileRef = { fileSystemId, fileId: "root" }
  const stat: IdeallFile = {
    ref: root,
    kind: "directory",
    name: fileSystemId,
    mediaType: DIRECTORY_MEDIA_TYPE,
    capabilities: ["read-directory"],
    source: { kind: "app", id: fileSystemId },
  }
  return {
    descriptor: { fileSystemId, name: fileSystemId, root, source: stat.source },
    async stat(ref) {
      return ref.fileId === root.fileId ? stat : null
    },
    async readDirectory() {
      return { entries: [] }
    },
    async read(ref) {
      throw new FileSystemError("unsupported", "not readable", ref)
    },
    async write(ref) {
      throw new FileSystemError("unsupported", "not writable", ref)
    },
    async actions() {
      return []
    },
    async invoke(ref) {
      throw new FileSystemError("unsupported", "no actions", ref)
    },
  }
}

test("composite root: 根隐藏且直接列出核心子树，同一目标可被多处引用", async () => {
  const target: FileRef = { fileSystemId: "local", fileId: "bookmarks" }
  const root = new CompositeRootFileSystem({
    coreEntries: [
      { entryId: "following", name: "关注", target, sortKey: "a" },
      { entryId: "bookmarks", name: "书签", target, sortKey: "b" },
    ],
  })

  const rootFile = await root.stat(root.descriptor.root, ctx)
  assert.equal(rootFile?.properties?.hidden, true)
  assert.deepEqual(
    (await root.readDirectory(root.descriptor.root, ctx)).entries.map((entry) => ({
      id: entry.entryId,
      kind: entry.kind,
      target: entry.target,
    })),
    [
      { id: "following", kind: "link", target },
      { id: "bookmarks", kind: "link", target },
    ],
  )
})

test("composite root: 动态挂载可观察、可分页，卸载不删除 provider 文件", async () => {
  const registry = new FileSystemRegistry()
  const root = new CompositeRootFileSystem({
    coreEntries: [
      {
        entryId: "home",
        name: "Home",
        target: { fileSystemId: "system", fileId: "home" },
        sortKey: "a",
      },
    ],
  })
  const app = provider("app.audio")
  const events: string[] = []
  root.watch(root.descriptor.root, ctx, () => {
    throw new Error("observer failed")
  })
  root.watch(root.descriptor.root, ctx, (event) => events.push(`${event.type}:${event.entryId}`))

  const unmount = mountFileSystem(registry, root, app, {
    entryId: "audio",
    name: "音频",
    sortKey: "b",
  })
  assert.equal(registry.get("app.audio"), app)
  assert.deepEqual(events, ["mount-changed:audio"])

  const first = await root.readDirectory(root.descriptor.root, ctx, { limit: 1 })
  assert.deepEqual(
    first.entries.map((entry) => entry.entryId),
    ["home"],
  )
  assert.equal(first.nextCursor, "1")
  const second = await root.readDirectory(root.descriptor.root, ctx, {
    cursor: first.nextCursor,
    limit: 1,
  })
  assert.deepEqual(
    second.entries.map((entry) => entry.entryId),
    ["audio"],
  )
  assert.equal(second.entries[0].kind, "mount")

  const targetBeforeUnmount = await registry.stat(app.descriptor.root, ctx)
  unmount()
  assert.equal(targetBeforeUnmount?.name, "app.audio")
  assert.equal(registry.get("app.audio"), null)
  assert.deepEqual(
    (await root.readDirectory(root.descriptor.root, ctx)).entries.map((entry) => entry.entryId),
    ["home"],
  )
  assert.deepEqual(events, ["mount-changed:audio", "mount-changed:audio"])
})

test("composite root: 名称冲突会回滚 provider 注册", () => {
  const registry = new FileSystemRegistry()
  const root = new CompositeRootFileSystem({
    coreEntries: [
      {
        entryId: "files",
        name: "文件",
        target: { fileSystemId: "local", fileId: "files" },
      },
    ],
  })
  const app = provider("third-party.files")

  assert.throws(
    () => mountFileSystem(registry, root, app, { entryId: "app-files", name: "文件" }),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.equal(registry.get("third-party.files"), null)
})

test("composite root: batch 只在组合事务提交后通知最终挂载状态", () => {
  const root = new CompositeRootFileSystem()
  const snapshots: string[][] = []
  root.watch(root.descriptor.root, ctx, () => {
    snapshots.push(root.listEntries().map((entry) => entry.entryId))
  })

  root.batch(() => {
    root.mount({
      entryId: "temporary",
      name: "Temporary",
      target: { fileSystemId: "app.temporary", fileId: "root" },
    })()
    root.mount({
      entryId: "committed",
      name: "Committed",
      target: { fileSystemId: "app.committed", fileId: "root" },
    })
    assert.deepEqual(snapshots, [])
  })

  assert.deepEqual(snapshots, [["committed"], ["committed"]])
})

test("composite root: 非根读取与非法分页参数返回结构化错误", async () => {
  const root = new CompositeRootFileSystem()
  await assert.rejects(
    () =>
      root.readDirectory({ fileSystemId: root.descriptor.fileSystemId, fileId: "missing" }, ctx),
    (error) => error instanceof FileSystemError && error.code === "not-found",
  )
  await assert.rejects(
    () => root.readDirectory(root.descriptor.root, ctx, { cursor: "bad" }),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
})
