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

test("builtin engines: app FileSystem roots resolve to their semantic engines", () => {
  registerBuiltInEngines()
  for (const [mediaType, engineId] of [
    ["application/vnd.ideall.audio.library+json", "ideall.audio"],
    ["application/vnd.ideall.database.workspace+json", "ideall.database"],
    ["application/vnd.ideall.git.repositories+json", "ideall.git"],
  ] as const) {
    const properties = engineId === "ideall.git" ? { git: true } : {}
    assert.equal(
      engineRegistry.resolve(file(mediaType, "directory", properties))?.descriptor.engineId,
      engineId,
    )
  }
})

test("builtin engines: core place and trash roots resolve to management displays", () => {
  registerBuiltInEngines()
  for (const [place, engineId] of [
    ["subscriptions", "ideall.subscriptions"],
    ["bookmarks", "ideall.bookmarks"],
    ["files", "ideall.resources"],
  ] as const) {
    const root = file("inode/directory", "directory", { place, rootChild: true })
    assert.equal(engineRegistry.resolve(root)?.descriptor.engineId, engineId)
    assert.deepEqual(
      engineRegistry.matching(root).map(({ descriptor }) => descriptor.engineId),
      [engineId, "ideall.directory", "ideall.preview"],
    )
  }

  const trash = file("application/vnd.ideall.trash+json", "directory", { trashRoot: true })
  assert.equal(engineRegistry.resolve(trash)?.descriptor.engineId, "ideall.trash")
  assert.deepEqual(
    engineRegistry.matching(trash).map(({ descriptor }) => descriptor.engineId),
    ["ideall.trash", "ideall.directory", "ideall.preview"],
  )
})

test("builtin engines: note pages keep their editor while also acting as directories", () => {
  registerBuiltInEngines()
  const note = file("application/vnd.ideall.note+json", "directory")
  assert.equal(engineRegistry.resolve(note)?.descriptor.engineId, "ideall.note")
  assert.deepEqual(
    engineRegistry.matching(note).map(({ descriptor }) => descriptor.engineId),
    ["ideall.note", "ideall.directory", "ideall.preview"],
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
  const panel = file("application/vnd.ideall.panel.home-overview+json", "file", {
    panelLayout: "padded",
  })
  assert.equal(engineRegistry.resolve(panel)?.descriptor.engineId, "ideall.panel")
  assert.deepEqual(
    engineRegistry.matching(panel).map(({ descriptor }) => descriptor.engineId),
    ["ideall.panel", "ideall.preview"],
  )
  assert.equal(
    engineRegistry.resolve(
      file("application/vnd.ideall.panel.ai-tasks+json", "file", { panelLayout: "fill" }),
    )?.descriptor.engineId,
    "ideall.panel-fill",
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
    engineRegistry.resolve(file("application/vnd.ideall.installed-app+json"))?.descriptor.engineId,
    "ideall.installed-app",
  )
  assert.deepEqual(
    engineRegistry
      .matching(file("application/vnd.ideall.installed-app+json"))
      .map(({ descriptor }) => descriptor.engineId),
    ["ideall.installed-app", "ideall.preview"],
  )
  assert.deepEqual(
    engineRegistry
      .matching(file("application/vnd.ideall.database+json"))
      .map(({ descriptor }) => descriptor.engineId),
    ["ideall.database", "ideall.code", "ideall.preview"],
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
    "ideall.installed-app",
    "ideall.subscriptions",
    "ideall.bookmarks",
    "ideall.resources",
    "ideall.trash",
    "ideall.panel",
    "ideall.panel-fill",
  ]) {
    assert.equal(engineRegistry.get(engineId)?.supportsStandaloneWindow, false, engineId)
  }
  assert.equal(engineRegistry.get("ideall.code")?.supportsStandaloneWindow, true)
  assert.equal(engineRegistry.get("ideall.preview")?.supportsStandaloneWindow, true)
})

test("builtin engines: editable text renderers declare serializable suspension", () => {
  registerBuiltInEngines()
  assert.equal(engineRegistry.get("ideall.code")?.suspension, "serializable")
  assert.equal(engineRegistry.get("ideall.preview")?.suspension, "serializable")
  assert.equal(engineRegistry.get("ideall.shell")?.suspension, undefined)
})
