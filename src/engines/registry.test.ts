import assert from "node:assert/strict"
import { test } from "node:test"
import type { EngineDescriptor } from "@protocol/engine"
import type { IdeallFile } from "@protocol/file-system"
import {
  emptyEnginePreferences,
  withEngineAssociationRemoved,
  withFileEnginePreference,
  withMediaTypeEnginePreference,
} from "./preferences"
import {
  EngineRegistry,
  EngineRegistryError,
  filterRemovedEngineAssociations,
  listMatchingEngines,
  resolveDefaultEngine,
} from "./registry"

const file: IdeallFile = {
  ref: { fileSystemId: "local", fileId: "n-1" },
  kind: "file",
  name: "design.md",
  mediaType: "text/markdown",
  capabilities: ["read", "write"],
  source: { kind: "local", id: "local" },
  properties: {},
}

function engine(
  engineId: string,
  priority: number,
  mediaTypes: readonly string[] = ["text/*"],
): EngineDescriptor {
  return {
    engineId,
    label: engineId,
    priority,
    match: { kinds: ["file"], mediaTypes },
    layout: "fill",
    access: "read-write",
    supportsStandaloneWindow: true,
  }
}

test("engine resolver: 文件偏好优先于 media type 偏好和 descriptor priority", () => {
  const descriptors = [engine("high", 100), engine("media", 20), engine("file", -10)]
  let preferences = emptyEnginePreferences()
  preferences = withMediaTypeEnginePreference(preferences, "TEXT/MARKDOWN", "media")
  preferences = withFileEnginePreference(preferences, file.ref, "file")

  assert.deepEqual(resolveDefaultEngine(descriptors, file, preferences), {
    descriptor: descriptors[2],
    priority: -10,
    specificity: 245,
    source: "file-preference",
  })
})

test("engine resolver: 无文件偏好时使用 media type 偏好", () => {
  const descriptors = [engine("high", 100), engine("media", 0)]
  const preferences = withMediaTypeEnginePreference(
    emptyEnginePreferences(),
    "text/markdown; charset=utf-8",
    "media",
  )

  assert.equal(resolveDefaultEngine(descriptors, file, preferences)?.descriptor.engineId, "media")
  assert.equal(
    resolveDefaultEngine(descriptors, file, preferences)?.source,
    "media-type-preference",
  )
})

test("engine resolver: 失效偏好回退；priority、特异度与 engineId 决定稳定顺序", () => {
  const broad = engine("z-broad", 5, ["text/*"])
  const exactB = engine("b-exact", 5, ["text/markdown"])
  const exactA = engine("a-exact", 5, ["text/markdown"])
  const preferences = withFileEnginePreference(emptyEnginePreferences(), file.ref, "uninstalled")

  assert.deepEqual(
    listMatchingEngines([broad, exactB, exactA], file).map(
      (candidate) => candidate.descriptor.engineId,
    ),
    ["a-exact", "b-exact", "z-broad"],
  )
  assert.equal(
    resolveDefaultEngine([broad, exactB, exactA], file, preferences)?.descriptor.engineId,
    "a-exact",
  )
  assert.equal(resolveDefaultEngine([broad, exactB, exactA], file, preferences)?.source, "priority")
})

test("engine resolver: removed associations 从候选剔除并作用于偏好与 priority 层", () => {
  const descriptors = [engine("high", 100), engine("media", 20), engine("fallback", -10)]
  // 屏蔽最高 priority 引擎后，priority 层落到次优。
  const removed = withEngineAssociationRemoved(emptyEnginePreferences(), "text/markdown", "high")
  const resolution = resolveDefaultEngine(descriptors, file, removed)
  assert.equal(resolution?.descriptor.engineId, "media")
  assert.equal(resolution?.source, "priority")

  // 屏蔽指向的 media type 偏好静默下落到次优候选（先设默认、后屏蔽）。
  const preferred = withMediaTypeEnginePreference(emptyEnginePreferences(), "text/markdown", "high")
  const preferredThenRemoved = withEngineAssociationRemoved(preferred, "text/markdown", "high")
  const fellThrough = resolveDefaultEngine(descriptors, file, preferredThenRemoved)
  assert.equal(fellThrough?.descriptor.engineId, "media")
  assert.equal(fellThrough?.source, "priority")

  // 屏蔽沿 subclass 父链生效：text/plain 上的屏蔽对 text/markdown 同样生效。
  const removedParent = withEngineAssociationRemoved(emptyEnginePreferences(), "text/plain", "high")
  assert.equal(resolveDefaultEngine(descriptors, file, removedParent)?.descriptor.engineId, "media")

  // 单文件偏好是逐文件显式选择，先于类型级屏蔽。
  const withFilePreference = withFileEnginePreference(removed, file.ref, "high")
  const fileResolution = resolveDefaultEngine(descriptors, file, withFilePreference)
  assert.equal(fileResolution?.descriptor.engineId, "high")
  assert.equal(fileResolution?.source, "file-preference")

  // 屏蔽未注册/不匹配引擎为惰性无效。
  const removedUnknown = withEngineAssociationRemoved(
    emptyEnginePreferences(),
    "text/markdown",
    "nope",
  )
  assert.equal(resolveDefaultEngine(descriptors, file, removedUnknown)?.descriptor.engineId, "high")
})

test("engine resolver: removed 守卫——屏蔽不得清空候选", () => {
  const descriptors = [engine("high", 100), engine("media", 20)]
  let preferences = withEngineAssociationRemoved(emptyEnginePreferences(), "text/markdown", "high")
  preferences = withEngineAssociationRemoved(preferences, "text/markdown", "media")

  // 全部候选都被屏蔽时屏蔽失效，文件不会因此打不开。
  assert.deepEqual(
    filterRemovedEngineAssociations(
      listMatchingEngines(descriptors, file),
      preferences,
      file.mediaType,
    ).map((candidate) => candidate.descriptor.engineId),
    ["high", "media"],
  )
  assert.equal(resolveDefaultEngine(descriptors, file, preferences)?.descriptor.engineId, "high")
})

test("engine registry: 多引擎注册、查询、通知和精确注销", () => {
  const registry = new EngineRegistry()
  let changes = 0
  registry.subscribe(() => (changes += 1))
  const removeB = registry.register(engine("b", 1))
  registry.register(engine("a", 2))

  assert.deepEqual(
    registry.list().map((item) => item.engineId),
    ["a", "b"],
  )
  assert.equal(registry.resolve(file)?.descriptor.engineId, "a")
  assert.equal(registry.matching(file).length, 2)
  assert.equal(registry.revision(), 2)
  assert.equal(changes, 2)

  removeB()
  removeB()
  assert.equal(registry.get("b"), null)
  assert.equal(registry.revision(), 3)
  assert.equal(changes, 3)
})

test("engine registry: 拒绝重复 id 与非有限 priority", () => {
  const registry = new EngineRegistry()
  registry.register(engine("same", 1))
  assert.throws(
    () => registry.register(engine("same", 2)),
    (error) => error instanceof EngineRegistryError && error.code === "duplicate-engine",
  )
  assert.throws(
    () => registry.register(engine("bad", Number.NaN)),
    (error) => error instanceof EngineRegistryError && error.code === "invalid-descriptor",
  )
})

test("engine registry: runtime descriptor fields and matcher values fail closed", () => {
  const invalidDescriptors: Array<[string, unknown]> = [
    ["layout", { ...engine("bad-layout", 1), layout: "overlay" }],
    ["access", { ...engine("bad-access", 1), access: "execute" }],
    ["suspension", { ...engine("bad-suspension", 1), suspension: "memory" }],
    ["supportsStandaloneWindow", { ...engine("bad-window", 1), supportsStandaloneWindow: "yes" }],
    ["match", { ...engine("bad-match", 1), match: "text/*" }],
    ["kinds", { ...engine("bad-kind", 1), match: { kinds: ["symlink"] } }],
    ["mediaTypes", { ...engine("bad-media", 1), match: { mediaTypes: [42] } }],
    [
      "requiredCapabilities",
      { ...engine("bad-capability", 1), match: { requiredCapabilities: [null] } },
    ],
    ["properties", { ...engine("bad-property", 1), match: { properties: { mode: {} } } }],
  ]

  for (const [field, descriptor] of invalidDescriptors) {
    const registry = new EngineRegistry()
    assert.throws(
      () => registry.register(descriptor as EngineDescriptor),
      (error) =>
        error instanceof EngineRegistryError &&
        error.code === "invalid-descriptor" &&
        error.message.includes(field),
    )
    assert.deepEqual(registry.list(), [])
  }
})

test("engine registry: throwing observer is isolated from committed mutations", () => {
  const registry = new EngineRegistry()
  let healthyCalls = 0
  registry.subscribe(() => {
    throw new Error("observer boom")
  })
  registry.subscribe(() => {
    healthyCalls += 1
  })

  const dispose = registry.register(engine("safe", 1))
  assert.equal(registry.get("safe")?.engineId, "safe")
  assert.equal(healthyCalls, 1)
  assert.doesNotThrow(dispose)
  assert.equal(healthyCalls, 2)
})
