import assert from "node:assert/strict"
import { test } from "node:test"
import { ENGINES_ROOT_REF } from "@/filesystem/builtin-app-roots"
import type { FileSystemAccessContext, FileSystemWatchEvent } from "@/filesystem/types"
import { BUILTIN_ENGINES, engineRegistry, registerBuiltInEngines } from "@/engines/builtin"
import { createEngineDescriptorsFileSystem } from "./engine-descriptors-file-system"

const UI = { actor: "ui", permissions: [] } as const

function ctx(intent: FileSystemAccessContext["intent"]): FileSystemAccessContext {
  return { ...UI, intent }
}

test("engine descriptors fs: readDirectory 列出全部已注册引擎的只读描述符文件", async () => {
  registerBuiltInEngines()
  const fs = createEngineDescriptorsFileSystem()

  const root = await fs.stat(ENGINES_ROOT_REF, ctx("metadata"))
  assert.equal(root?.kind, "directory")

  const directory = await fs.readDirectory(ENGINES_ROOT_REF, ctx("directory"), { limit: 500 })
  assert.equal(directory.nextCursor, undefined)
  const ids = directory.entries.map((entry) => entry.entryId)
  assert.deepEqual(ids, BUILTIN_ENGINES.map((descriptor) => descriptor.engineId).sort())
  assert.equal(directory.entries[0]?.kind, "child")
  assert.ok(directory.entries.every((entry) => entry.name.endsWith(".json")))

  // 分页：cursor 单调且按序推进，重复非法 cursor 报错。
  const first = await fs.readDirectory(ENGINES_ROOT_REF, ctx("directory"), { limit: 5 })
  assert.equal(first.entries.length, 5)
  assert.ok(first.nextCursor)
  const rest = await fs.readDirectory(ENGINES_ROOT_REF, ctx("directory"), {
    limit: 500,
    cursor: first.nextCursor,
  })
  assert.deepEqual(
    [...first.entries, ...rest.entries].map((entry) => entry.entryId),
    ids,
  )
  await assert.rejects(
    fs.readDirectory(ENGINES_ROOT_REF, ctx("directory"), { cursor: "01x" }),
    /Unknown engines directory cursor/,
  )
})

test("engine descriptors fs: read 返回公开元数据且版本稳定，write/invoke 只读拒绝", async () => {
  registerBuiltInEngines()
  const fs = createEngineDescriptorsFileSystem()
  const ref = { fileSystemId: "app.engines", fileId: "engine:ideall.code" }

  const stat = await fs.stat(ref, ctx("metadata"))
  assert.equal(stat?.mediaType, "application/json")
  assert.deepEqual(stat?.capabilities, ["read", "watch"])
  assert.ok(stat?.version?.startsWith("display-engine-descriptors-v1:"))

  const read = await fs.read(ref, ctx("content"), { encoding: "json" })
  const document = read.data as { version: number; descriptor: Record<string, unknown> }
  assert.equal(document.version, 1)
  assert.equal(document.descriptor.engineId, "ideall.code")
  assert.equal(document.descriptor.label, "开发")
  assert.equal("renderer" in document.descriptor, false, "投影不含 renderer 代码")
  assert.equal(read.version, stat?.version, "同内容同版本（确定性序列化）")

  const statMissing = await fs.stat(
    { fileSystemId: "app.engines", fileId: "engine:nope" },
    ctx("metadata"),
  )
  assert.equal(statMissing, null)
  await assert.rejects(
    fs.read({ fileSystemId: "app.engines", fileId: "engine:nope" }, ctx("content")),
    /not-found|not found/i,
  )

  await assert.rejects(fs.write(ref, { data: {} }, ctx("write")), /unsupported|read-only/)
  await assert.rejects(fs.invoke(ref, "x", {}, ctx("action")), /have no actions/)
  assert.deepEqual(await fs.actions(ref, ctx("action")), [])
})

test("engine descriptors fs: watch 跟随注册表变化（注册 created / 注销 deleted）", async () => {
  registerBuiltInEngines()
  const fs = createEngineDescriptorsFileSystem()
  const events: FileSystemWatchEvent[] = []

  const rootHandle = fs.watch!(ENGINES_ROOT_REF, ctx("watch"), (event) => events.push(event))
  assert.ok(rootHandle)
  const engineRef = { fileSystemId: "app.engines", fileId: "engine:test.ephemeral" }
  const fileEvents: FileSystemWatchEvent[] = []
  const fileHandle = fs.watch!(engineRef, ctx("watch"), (event) => fileEvents.push(event))
  assert.ok(fileHandle)

  const dispose = engineRegistry.register({
    engineId: "test.ephemeral",
    label: "临时",
    layout: "fill",
    access: "read-only",
  })
  assert.deepEqual(
    events.map((event) => event.type),
    ["created"],
  )
  assert.deepEqual(
    fileEvents.map((event) => event.type),
    ["created"],
  )

  dispose()
  assert.deepEqual(
    events.map((event) => event.type),
    ["created", "deleted"],
  )
  assert.deepEqual(
    fileEvents.map((event) => event.type),
    ["created", "deleted"],
  )
  assert.equal(events[1]?.oldParent && true, true)

  // 无关引擎文件 watcher 收不到其他引擎的事件（独立数组隔离断言）。
  const otherEvents: FileSystemWatchEvent[] = []
  const other = fs.watch!(
    { fileSystemId: "app.engines", fileId: "engine:ideall.code" },
    ctx("watch"),
    (event) => otherEvents.push(event),
  )
  const before = events.length
  const disposeTwo = engineRegistry.register({
    engineId: "test.ephemeral-2",
    label: "临时二",
    layout: "fill",
    access: "read-only",
  })
  disposeTwo()
  other!.dispose()
  rootHandle!.dispose()
  fileHandle!.dispose()
  assert.ok(events.length > before, "root watcher 继续收到全部事件")
  assert.deepEqual(otherEvents, [], "无关引擎文件 watcher 被过滤")
})
