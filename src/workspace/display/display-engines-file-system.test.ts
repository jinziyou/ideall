import assert from "node:assert/strict"
import { test } from "node:test"
import { DISPLAY_ENGINES_FILE_REF, DISPLAY_ROOT_REF } from "@/filesystem/builtin-app-roots"
import { FileSystemError } from "@/filesystem/types"
import type { FileSystemAccessContext } from "@/filesystem/types"
import {
  emptyEnginePreferences,
  getMediaTypeEnginePreference,
  getRemovedEngineAssociations,
  isEngineAssociationRemoved,
  withMediaTypeEnginePreference,
  type EnginePreferenceScope,
  type EnginePreferences,
} from "@/engines/preferences"
import {
  DISPLAY_ENGINES_REMOVE_ASSOCIATION_ACTION,
  DISPLAY_ENGINES_RESTORE_ASSOCIATION_ACTION,
  DISPLAY_ENGINES_SET_FILE_DEFAULT_ACTION,
  DISPLAY_ENGINES_SET_MEDIA_TYPE_DEFAULT_ACTION,
  DISPLAY_ENGINES_WRITE_PERMISSION,
} from "./display-engines-file-contract"
import {
  createDisplayEnginesFileSystem,
  type DisplayEnginesFileSystemDeps,
} from "./display-engines-file-system"

const UI = { actor: "ui", permissions: [] } as const
const AGENT_FS_READ = { actor: "agent", permissions: ["fs:read"] } as const
const AGENT_FS_WRITE = { actor: "agent", permissions: ["fs:write"] } as const
const AGENT_ENGINES_WRITE = {
  actor: "agent",
  permissions: [DISPLAY_ENGINES_WRITE_PERMISSION],
} as const

type CtxBase = Readonly<{ actor: FileSystemAccessContext["actor"]; permissions: readonly string[] }>

function ctx(base: CtxBase, intent: FileSystemAccessContext["intent"]): FileSystemAccessContext {
  return { ...base, intent } as FileSystemAccessContext
}

function memoryDeps(initial?: Partial<Record<EnginePreferenceScope, EnginePreferences>>) {
  const data = new Map<EnginePreferenceScope, EnginePreferences>()
  const listeners = new Set<() => void>()
  const deps: DisplayEnginesFileSystemDeps = {
    read: (scope) => data.get(scope) ?? initial?.[scope] ?? emptyEnginePreferences(),
    write: (scope, preferences) => {
      data.set(scope, preferences)
      return true
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return { data, listeners, deps }
}

test("display engines fs: stat/read 投影三个 scope 的关联文档", async () => {
  const { deps } = memoryDeps({
    files: withMediaTypeEnginePreference(emptyEnginePreferences(), "text/plain", "plain.editor"),
  })
  const fs = createDisplayEnginesFileSystem(deps)

  const root = await fs.stat(DISPLAY_ROOT_REF, ctx(UI, "metadata"))
  assert.equal(root?.kind, "directory")
  const file = await fs.stat(DISPLAY_ENGINES_FILE_REF, ctx(UI, "metadata"))
  assert.equal(file?.mediaType, "application/json")
  assert.ok(file?.version?.startsWith("display-engine-associations-v1:"))
  assert.equal(
    await fs.stat({ fileSystemId: "app.display", fileId: "nope" }, ctx(UI, "metadata")),
    null,
  )

  const directory = await fs.readDirectory(DISPLAY_ROOT_REF, ctx(UI, "directory"))
  assert.deepEqual(
    directory.entries.map((entry) => entry.name),
    ["engines.json"],
  )

  const read = await fs.read(DISPLAY_ENGINES_FILE_REF, ctx(UI, "content"), { encoding: "json" })
  const document = read.data as {
    version: number
    scopes: Record<string, { mediaTypes: Record<string, string> }>
  }
  assert.equal(document.version, 2)
  assert.equal(document.scopes.files?.mediaTypes["text/plain"], "plain.editor")
  assert.deepEqual(document.scopes.audio?.mediaTypes, {})
  assert.equal(read.version, file?.version)

  // agent 持 fs:read 可读；无任何位不可读。
  await fs.read(DISPLAY_ENGINES_FILE_REF, ctx(AGENT_FS_READ, "content"), { encoding: "json" })
  await assert.rejects(
    fs.read(DISPLAY_ENGINES_FILE_REF, ctx({ actor: "embed", permissions: [] }, "content")),
    FileSystemError,
  )
})

test("display engines fs: 完整文档 write 走 CAS 并按 scope diff 提交", async () => {
  const { data, deps } = memoryDeps()
  const fs = createDisplayEnginesFileSystem(deps)
  const before = await fs.read(DISPLAY_ENGINES_FILE_REF, ctx(UI, "content"), { encoding: "json" })

  const document = {
    version: 2,
    scopes: {
      files: { files: {}, mediaTypes: { "text/plain": "plain.editor" }, removed: {} },
      audio: { files: {}, mediaTypes: {}, removed: { "audio/mpeg": ["some.player"] } },
      development: { files: {}, mediaTypes: {}, removed: {} },
    },
  }
  const written = await fs.write(
    DISPLAY_ENGINES_FILE_REF,
    { data: document, expectedVersion: before.version },
    ctx(UI, "write"),
  )
  assert.ok(written.version && written.version !== before.version)
  assert.equal(getMediaTypeEnginePreference(data.get("files")!, "text/plain"), "plain.editor")
  assert.equal(isEngineAssociationRemoved(data.get("audio")!, "audio/mpeg", "some.player"), true)
  assert.equal(data.has("development"), false, "未变化的 scope 不写入")

  // 陈旧版本冲突。
  await assert.rejects(
    fs.write(
      DISPLAY_ENGINES_FILE_REF,
      { data: document, expectedVersion: before.version },
      ctx(UI, "write"),
    ),
    /conflict|Display engines changed/,
  )
  // 缺 scope / 坏版本 / 坏媒体类型一律 invalid-input。
  await assert.rejects(
    fs.write(DISPLAY_ENGINES_FILE_REF, { data: { version: 1, scopes: {} } }, ctx(UI, "write")),
    /version: 2, scopes/,
  )
  await assert.rejects(
    fs.write(
      DISPLAY_ENGINES_FILE_REF,
      { data: document, mediaType: "text/plain" },
      ctx(UI, "write"),
    ),
    /require application\/json/,
  )
  // 无写权限的 agent 即使持 fs:write 也被拒（配置写需要 display.engines:write）。
  await assert.rejects(
    fs.write(DISPLAY_ENGINES_FILE_REF, { data: document }, ctx(AGENT_FS_WRITE, "write")),
    /Missing display\.engines:write permission/,
  )
  await fs.write(DISPLAY_ENGINES_FILE_REF, { data: document }, ctx(AGENT_ENGINES_WRITE, "write"))
})

test("display engines fs: specialized actions 单 scope 提交并返回新版本", async () => {
  const { data, deps } = memoryDeps()
  const fs = createDisplayEnginesFileSystem(deps)

  const setDefault = (await fs.invoke(
    DISPLAY_ENGINES_FILE_REF,
    DISPLAY_ENGINES_SET_MEDIA_TYPE_DEFAULT_ACTION,
    { scope: "files", mediaType: "text/plain", engineId: "plain.editor" },
    ctx(UI, "action"),
  )) as { changed: boolean; version: string }
  assert.equal(setDefault.changed, true)
  assert.equal(getMediaTypeEnginePreference(data.get("files")!, "text/plain"), "plain.editor")

  // 幂等：重复同值提交 changed=false。
  const repeat = (await fs.invoke(
    DISPLAY_ENGINES_FILE_REF,
    DISPLAY_ENGINES_SET_MEDIA_TYPE_DEFAULT_ACTION,
    { scope: "files", mediaType: "text/plain", engineId: "plain.editor" },
    ctx(UI, "action"),
  )) as { changed: boolean }
  assert.equal(repeat.changed, false)

  const blocked = (await fs.invoke(
    DISPLAY_ENGINES_FILE_REF,
    DISPLAY_ENGINES_REMOVE_ASSOCIATION_ACTION,
    { scope: "files", mediaType: "text/markdown", engineId: "code.editor" },
    ctx(UI, "action"),
  )) as { changed: boolean }
  assert.equal(blocked.changed, true)
  assert.deepEqual(getRemovedEngineAssociations(data.get("files")!, "text/markdown"), [
    "code.editor",
  ])

  const restored = (await fs.invoke(
    DISPLAY_ENGINES_FILE_REF,
    DISPLAY_ENGINES_RESTORE_ASSOCIATION_ACTION,
    { scope: "files", mediaType: "text/markdown", engineId: "code.editor" },
    ctx(UI, "action"),
  )) as { changed: boolean }
  assert.equal(restored.changed, true)
  assert.equal(data.get("files") && "text/markdown" in data.get("files")!.removed, false)

  const setFile = (await fs.invoke(
    DISPLAY_ENGINES_FILE_REF,
    DISPLAY_ENGINES_SET_FILE_DEFAULT_ACTION,
    { scope: "files", fileRef: "local:notes%2Fa.md", engineId: "note.editor" },
    ctx(UI, "action"),
  )) as { changed: boolean }
  assert.equal(setFile.changed, true)
  assert.equal(data.get("files")!.files["local:notes%2Fa.md"], "note.editor")

  // 坏输入 / 未知 action / 越权。
  await assert.rejects(
    fs.invoke(
      DISPLAY_ENGINES_FILE_REF,
      DISPLAY_ENGINES_SET_MEDIA_TYPE_DEFAULT_ACTION,
      { scope: "nope" },
      ctx(UI, "action"),
    ),
    /Invalid setMediaTypeDefault input/,
  )
  await assert.rejects(
    fs.invoke(DISPLAY_ENGINES_FILE_REF, "preferences.nope", {}, ctx(UI, "action")),
    /Unknown display engines action/,
  )
  await assert.rejects(
    fs.invoke(
      DISPLAY_ENGINES_FILE_REF,
      DISPLAY_ENGINES_SET_MEDIA_TYPE_DEFAULT_ACTION,
      { scope: "files", mediaType: "text/plain", engineId: "x" },
      ctx(AGENT_FS_WRITE, "action"),
    ),
    /Missing display\.engines:write permission/,
  )
})

test("display engines fs: watch 在源变更与 provider 写后通知，末位 watcher 释放源订阅", async () => {
  const { listeners, deps } = memoryDeps()
  const fs = createDisplayEnginesFileSystem(deps)

  let notifications = 0
  const handle = fs.watch!(DISPLAY_ENGINES_FILE_REF, ctx(UI, "watch"), (event) => {
    assert.equal(event.type, "changed")
    notifications += 1
  })
  assert.ok(handle)
  assert.equal(listeners.size, 1, "首个 watcher 建立源订阅")

  for (const listener of [...listeners]) listener()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(notifications, 1)

  await fs.invoke(
    DISPLAY_ENGINES_FILE_REF,
    DISPLAY_ENGINES_SET_MEDIA_TYPE_DEFAULT_ACTION,
    { scope: "files", mediaType: "text/plain", engineId: "plain.editor" },
    ctx(UI, "action"),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(notifications, 2)

  handle!.dispose()
  assert.equal(listeners.size, 0, "末位 watcher 释放源订阅")
  assert.equal(
    fs.watch!({ fileSystemId: "app.display", fileId: "nope" }, ctx(UI, "watch"), () => {}),
    null,
  )
})
