import { test } from "node:test"
import assert from "node:assert/strict"
import type { IdeallFile } from "@protocol/file-system"
import { resolveFileEngineRenderer } from "./file-engine-renderer"

function file(mediaType: string, properties: Readonly<Record<string, unknown>> = {}): IdeallFile {
  return {
    ref: { fileSystemId: "ideall.core", fileId: "fixture" },
    kind: "file",
    name: "fixture",
    mediaType,
    capabilities: ["read", "write"],
    source: { kind: "local", id: "test" },
    properties,
  }
}

test("file engine renderer: engine id wins over Node and panel provenance", () => {
  const bookmark = file("application/vnd.ideall.bookmark+json", {
    resourceScheme: "node",
    resourceKind: "bookmark",
    url: "https://example.com",
  })
  assert.equal(resolveFileEngineRenderer(bookmark, "ideall.bookmark"), "node-bookmark")
  assert.equal(resolveFileEngineRenderer(bookmark, "ideall.browser"), "browser")
  assert.equal(resolveFileEngineRenderer(bookmark, "ideall.preview"), "preview")

  const panel = file("application/vnd.ideall.panel.home-overview+json", {
    panelId: "home",
    tabKind: "home-overview",
  })
  assert.equal(resolveFileEngineRenderer(panel, "ideall.panel"), "panel")
  assert.equal(resolveFileEngineRenderer(panel, "ideall.preview"), "preview")
  assert.equal(resolveFileEngineRenderer(panel, "ideall.code"), "code")
})

test("file engine renderer: readable Resource text uses code, never the old file viewer", () => {
  const resourceFile = file("text/typescript", {
    resourceScheme: "node",
    resourceKind: "file",
  })
  assert.equal(resolveFileEngineRenderer(resourceFile, "ideall.code"), "code")
  assert.equal(resolveFileEngineRenderer(resourceFile, "ideall.preview"), "preview")
})

test("file engine renderer: semantic Node viewers cannot capture a different engine", () => {
  const note = file("application/vnd.ideall.note+json", {
    resourceScheme: "node",
    resourceKind: "note",
  })
  assert.equal(resolveFileEngineRenderer(note, "ideall.note"), "node-note")
  assert.equal(resolveFileEngineRenderer(note, "ideall.bookmark"), "unsupported")
})
