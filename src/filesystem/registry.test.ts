import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { DIRECTORY_MEDIA_TYPE, type FileRef, type IdeallFile } from "@protocol/file-system"
import {
  clearFileSystemsForTest,
  FileSystemRegistry,
  getFileSystem,
  registerFileSystem,
} from "./registry"
import { FileSystemError, type FileSystemAccessContext, type FileSystemProvider } from "./types"

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
      return [{ id: "open", label: "打开" }]
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
  assert.deepEqual(await registry.actions(ref, ctx), [{ id: "open", label: "打开" }])
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
