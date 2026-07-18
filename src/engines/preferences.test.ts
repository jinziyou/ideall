import assert from "node:assert/strict"
import { test } from "node:test"
import type { FileRef } from "@protocol/file-system"
import {
  ENGINE_PREFERENCES_STORAGE_KEY,
  ENGINE_PREFERENCES_VERSION,
  EnginePreferenceStore,
  enginePreferencesStorageKey,
  emptyEnginePreferences,
  getFileEnginePreference,
  getMediaTypeEnginePreference,
  getRemovedEngineAssociations,
  isEngineAssociationRemoved,
  parseEnginePreferences,
  readEnginePreferences,
  withEngineAssociationRemoved,
  withEngineAssociationRestored,
  withFileEnginePreference,
  withMediaTypeEnginePreference,
  writeEnginePreferences,
  type EnginePreferenceStorage,
} from "./preferences"

const ref: FileRef = { fileSystemId: "local:notes", fileId: "dir/a b.md" }

function memoryStorage(): EnginePreferenceStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

test("engine preferences: 单文件和 media type 偏好均可不可变地设置与移除", () => {
  const empty = emptyEnginePreferences()
  const withMedia = withMediaTypeEnginePreference(
    empty,
    " Text/Markdown; charset=utf-8 ",
    "markdown.preview",
  )
  const withFile = withFileEnginePreference(withMedia, ref, "code.editor")

  assert.equal(getMediaTypeEnginePreference(withFile, "text/markdown"), "markdown.preview")
  assert.equal(getFileEnginePreference(withFile, ref), "code.editor")
  assert.equal(getFileEnginePreference(empty, ref), null)
  assert.equal(getFileEnginePreference(withFileEnginePreference(withFile, ref, null), ref), null)
  assert.equal(
    getMediaTypeEnginePreference(
      withMediaTypeEnginePreference(withFile, "text/markdown", null),
      "text/markdown",
    ),
    null,
  )
  // 精确移除后不再有父链回落以外的命中：application/json 无精确偏好时回 null。
  assert.equal(getMediaTypeEnginePreference(withFile, "application/json"), null)
})

test("engine preferences: media type 偏好沿 subclass 父链继承（近亲优先）", () => {
  const empty = emptyEnginePreferences()
  const withPlain = withMediaTypeEnginePreference(empty, "text/plain", "plain.editor")

  // 父类型上的偏好对子类型生效（GIO 语义）。
  assert.equal(getMediaTypeEnginePreference(withPlain, "text/markdown"), "plain.editor")
  assert.equal(getMediaTypeEnginePreference(withPlain, "application/json"), "plain.editor")
  // 祖父类沿链上溯：application/ld+json → application/json → text/plain。
  assert.equal(getMediaTypeEnginePreference(withPlain, "application/ld+json"), "plain.editor")

  // 近亲优先：application/json 的精确偏好压过祖父 text/plain。
  const withJson = withMediaTypeEnginePreference(withPlain, "application/json", "json.editor")
  assert.equal(getMediaTypeEnginePreference(withJson, "application/ld+json"), "json.editor")
  assert.equal(getMediaTypeEnginePreference(withJson, "text/markdown"), "plain.editor")

  // 无链类型不继承；空值不命中。
  assert.equal(getMediaTypeEnginePreference(withPlain, "audio/mpeg"), null)
  assert.equal(getMediaTypeEnginePreference(withPlain, ""), null)
})

test("engine preferences: removed associations 设置/恢复与父链判定", () => {
  const empty = emptyEnginePreferences()
  assert.equal(isEngineAssociationRemoved(empty, "text/markdown", "code.editor"), false)

  const removed = withEngineAssociationRemoved(
    empty,
    " Text/Markdown; charset=utf-8 ",
    "code.editor",
  )
  assert.deepEqual(getRemovedEngineAssociations(removed, "text/markdown"), ["code.editor"])
  assert.equal(isEngineAssociationRemoved(removed, "text/markdown", "code.editor"), true)
  assert.equal(isEngineAssociationRemoved(removed, "text/markdown", "other.engine"), false)
  // 父类型屏蔽沿父链对子类型生效（与偏好查找同一遍历）。
  const removedParent = withEngineAssociationRemoved(empty, "text/plain", "plain.viewer")
  assert.equal(
    isEngineAssociationRemoved(removedParent, "application/ld+json", "plain.viewer"),
    true,
  )
  assert.equal(
    isEngineAssociationRemoved(removedParent, "application/ld+json", "code.editor"),
    false,
  )

  // 恢复只作用于精确级别；键清空后被移除。
  const restored = withEngineAssociationRestored(removed, "text/markdown", "code.editor")
  assert.deepEqual(getRemovedEngineAssociations(restored, "text/markdown"), [])
  assert.equal("text/markdown" in restored.removed, false)
  // 幂等：重复屏蔽不重复记录，重复恢复状态不变。
  const twice = withEngineAssociationRemoved(removed, "text/markdown", "code.editor")
  assert.deepEqual(getRemovedEngineAssociations(twice, "text/markdown"), ["code.editor"])
  assert.throws(() => withEngineAssociationRemoved(empty, "", "x"), TypeError)
  assert.throws(() => withEngineAssociationRemoved(empty, "text/plain", "  "), TypeError)
})

test("engine preferences: 设为默认自动解除同类型同引擎的屏蔽", () => {
  const removed = withEngineAssociationRemoved(
    emptyEnginePreferences(),
    "text/markdown",
    "code.editor",
  )
  const withDefault = withMediaTypeEnginePreference(removed, "text/markdown", "code.editor")
  assert.equal(getMediaTypeEnginePreference(withDefault, "text/markdown"), "code.editor")
  assert.deepEqual(getRemovedEngineAssociations(withDefault, "text/markdown"), [])
  // 对其他引擎的屏蔽不受影响。
  const removedTwo = withEngineAssociationRemoved(removed, "text/markdown", "other.engine")
  const withDefaultTwo = withMediaTypeEnginePreference(removedTwo, "text/markdown", "code.editor")
  assert.deepEqual(getRemovedEngineAssociations(withDefaultTwo, "text/markdown"), ["other.engine"])
})

test("engine preferences: v1 数据读取升级为 v2（空 removed），写出一律 v2", () => {
  const storage = memoryStorage()
  storage.setItem(
    ENGINE_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ version: 1, files: {}, mediaTypes: { "text/plain": "plain.editor" } }),
  )
  const upgraded = readEnginePreferences(storage)
  assert.equal(upgraded.version, ENGINE_PREFERENCES_VERSION)
  assert.equal(getMediaTypeEnginePreference(upgraded, "text/plain"), "plain.editor")
  assert.deepEqual(getRemovedEngineAssociations(upgraded, "text/plain"), [])

  const withRemoved = withEngineAssociationRemoved(upgraded, "text/plain", "plain.viewer")
  assert.equal(writeEnginePreferences(storage, withRemoved), true)
  const persisted = JSON.parse(storage.data.get(ENGINE_PREFERENCES_STORAGE_KEY)!)
  assert.equal(persisted.version, 2)
  assert.deepEqual(persisted.removed, { "text/plain": ["plain.viewer"] })
  // 回读恢复屏蔽表。
  assert.equal(
    isEngineAssociationRemoved(readEnginePreferences(storage), "text/plain", "plain.viewer"),
    true,
  )
  // 更高版本（未来格式）fail closed 回退空偏好。
  storage.setItem(ENGINE_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 3, mediaTypes: {} }))
  assert.deepEqual(readEnginePreferences(storage), emptyEnginePreferences())
})

test("engine preferences: removed 表消毒——非法类型/引擎 id/非数组被剔除", () => {
  const parsed = parseEnginePreferences(
    JSON.stringify({
      version: 2,
      files: {},
      mediaTypes: {},
      removed: {
        " TEXT/PLAIN; charset=utf-8 ": ["a", "a", "b", " ", 42],
        "": ["x"],
        "audio/mpeg": "not-an-array",
        "video/mp4": [],
      },
    }),
  )
  assert.deepEqual(getRemovedEngineAssociations(parsed, "text/plain"), ["a", "b"])
  assert.deepEqual(Object.keys(parsed.removed), ["text/plain"])
})

test("engine preferences: 注入存储后可持久化、重载和清空", () => {
  const storage = memoryStorage()
  const store = new EnginePreferenceStore(storage)

  assert.equal(store.setFile(ref, "code.editor"), true)
  assert.equal(store.setMediaType("audio/mpeg", "audio.player"), true)
  const reloaded = new EnginePreferenceStore(storage)
  assert.equal(getFileEnginePreference(reloaded.snapshot(), ref), "code.editor")
  assert.equal(getMediaTypeEnginePreference(reloaded.snapshot(), "audio/mpeg"), "audio.player")
  assert.ok(storage.data.has(ENGINE_PREFERENCES_STORAGE_KEY))

  assert.equal(reloaded.clear(), true)
  assert.equal(storage.data.has(ENGINE_PREFERENCES_STORAGE_KEY), false)
  assert.deepEqual(reloaded.snapshot(), emptyEnginePreferences())
})

test("engine preferences: 坏数据、旧版本和存储异常安全回退", () => {
  assert.deepEqual(parseEnginePreferences("not json"), emptyEnginePreferences())
  assert.deepEqual(
    parseEnginePreferences(JSON.stringify({ version: 0, files: { bad: "engine" } })),
    emptyEnginePreferences(),
  )

  const partiallyValid = parseEnginePreferences(
    JSON.stringify({
      version: 1,
      files: { good: "preview", empty: "" },
      mediaTypes: { "TEXT/PLAIN": "text", "": "bad", invalid: 7 },
    }),
  )
  assert.deepEqual(partiallyValid.files, { good: "preview" })
  assert.deepEqual(partiallyValid.mediaTypes, { "text/plain": "text" })

  const broken: EnginePreferenceStorage = {
    getItem: () => {
      throw new Error("denied")
    },
    setItem: () => {
      throw new Error("denied")
    },
    removeItem: () => {
      throw new Error("denied")
    },
  }
  assert.deepEqual(readEnginePreferences(broken), emptyEnginePreferences())
  assert.equal(writeEnginePreferences(broken, emptyEnginePreferences()), false)
  assert.equal(new EnginePreferenceStore(broken).clear(), false)
})

test("engine preferences: 无注入存储时保持纯内存工作", () => {
  const store = new EnginePreferenceStore(undefined, "custom")
  assert.equal(store.setFile(ref, "preview"), false)
  assert.equal(getFileEnginePreference(store.snapshot(), ref), "preview")
})

test("engine preferences: 工作区作用域隔离且 files 兼容旧存储键", () => {
  assert.equal(enginePreferencesStorageKey("files"), ENGINE_PREFERENCES_STORAGE_KEY)
  assert.equal(enginePreferencesStorageKey("audio"), `${ENGINE_PREFERENCES_STORAGE_KEY}:audio`)
  assert.equal(
    enginePreferencesStorageKey("development"),
    `${ENGINE_PREFERENCES_STORAGE_KEY}:development`,
  )

  const storage = memoryStorage()
  const files = new EnginePreferenceStore(storage, enginePreferencesStorageKey("files"))
  const audio = new EnginePreferenceStore(storage, enginePreferencesStorageKey("audio"))
  files.setFile(ref, "ideall.preview")
  audio.setFile(ref, "ideall.audio")
  assert.equal(getFileEnginePreference(files.snapshot(), ref), "ideall.preview")
  assert.equal(getFileEnginePreference(audio.snapshot(), ref), "ideall.audio")
})
