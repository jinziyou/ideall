import assert from "node:assert/strict"
import { test } from "node:test"
import type { EngineDescriptor } from "@protocol/engine"
import type { IdeallFile } from "@protocol/file-system"
import {
  emptyEnginePreferences,
  withFileEnginePreference,
  withMediaTypeEnginePreference,
} from "./preferences"
import {
  EngineRegistry,
  EngineRegistryError,
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
  assert.equal(changes, 2)

  removeB()
  removeB()
  assert.equal(registry.get("b"), null)
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
