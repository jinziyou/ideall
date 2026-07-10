import { test } from "node:test"
import assert from "node:assert/strict"
import type { IdeallFile } from "@protocol/file-system"
import { emptyEnginePreferences, withMediaTypeEnginePreference } from "./preferences"
import { engineRegistry, registerBuiltInEngines } from "./builtin"

function file(
  mediaType: string,
  kind: IdeallFile["kind"] = "file",
  properties: Readonly<Record<string, unknown>> = {},
): IdeallFile {
  return {
    ref: { fileSystemId: "test", fileId: mediaType },
    kind,
    name: "fixture",
    mediaType,
    capabilities: ["read", "write"],
    source: { kind: "local", id: "test" },
    properties,
  }
}

test("builtin engines: audio and source files resolve to scenario engines", () => {
  registerBuiltInEngines()
  assert.equal(engineRegistry.resolve(file("audio/flac"))?.descriptor.engineId, "ideall.audio")
  assert.equal(engineRegistry.resolve(file("text/typescript"))?.descriptor.engineId, "ideall.code")
  assert.equal(
    engineRegistry.resolve(file("inode/directory", "directory"))?.descriptor.engineId,
    "ideall.directory",
  )
})

test("builtin engines: user media-type preference overrides scenario priority", () => {
  registerBuiltInEngines()
  const preferences = withMediaTypeEnginePreference(
    emptyEnginePreferences(),
    "audio/flac",
    "ideall.preview",
  )
  assert.equal(
    engineRegistry.resolve(file("audio/flac"), preferences)?.descriptor.engineId,
    "ideall.preview",
  )
})

test("builtin engines: semantic panel JSON is not captured by the code engine", () => {
  registerBuiltInEngines()
  const panel = file("application/vnd.ideall.panel.home-overview+json")
  assert.equal(engineRegistry.resolve(panel)?.descriptor.engineId, "ideall.panel")
  assert.deepEqual(
    engineRegistry.matching(panel).map(({ descriptor }) => descriptor.engineId),
    ["ideall.panel", "ideall.preview"],
  )
  assert.equal(engineRegistry.resolve(file("application/json"))?.descriptor.engineId, "ideall.code")
  assert.equal(engineRegistry.resolve(file("text/uri-list"))?.descriptor.engineId, "ideall.browser")
  assert.deepEqual(
    engineRegistry
      .matching(file("application/vnd.ideall.info.entity+json"))
      .map(({ descriptor }) => descriptor.engineId),
    ["ideall.connected", "ideall.preview"],
  )
  assert.equal(
    engineRegistry.resolve(file("application/vnd.ideall.audio+json"))?.descriptor.engineId,
    "ideall.audio",
  )
  assert.equal(
    engineRegistry.resolve(file("application/vnd.ideall.git+json", "file", { git: true }))
      ?.descriptor.engineId,
    "ideall.git",
  )
})

test("builtin engines: privileged main-window viewers cannot be opened standalone", () => {
  registerBuiltInEngines()
  for (const engineId of [
    "ideall.browser",
    "ideall.git",
    "ideall.shell",
    "ideall.connected",
    "ideall.panel",
  ]) {
    assert.equal(engineRegistry.get(engineId)?.supportsStandaloneWindow, false, engineId)
  }
  assert.equal(engineRegistry.get("ideall.code")?.supportsStandaloneWindow, true)
  assert.equal(engineRegistry.get("ideall.preview")?.supportsStandaloneWindow, true)
})
