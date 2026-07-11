import { test } from "node:test"
import assert from "node:assert/strict"
import type { IdeallFile } from "@protocol/file-system"
import { registerBuiltInEngines, engineRegistry } from "@/engines/builtin"
import { resolveWorkspaceEngine } from "./workspace-engine"

registerBuiltInEngines()

function file(mediaType: string): IdeallFile {
  return {
    ref: { fileSystemId: "test", fileId: mediaType },
    kind: "file",
    name: "sample",
    mediaType,
    capabilities: ["read"],
    source: { kind: "local", id: "test" },
  }
}

function resolve(mediaType: string, workspace: "files" | "audio" | "development") {
  const target = file(mediaType)
  return resolveWorkspaceEngine(
    target,
    workspace,
    engineRegistry.matching(target),
    engineRegistry.resolve(target),
  )?.descriptor.engineId
}

test("workspace engine: 普通、音频与开发工作区提供各自默认渲染", () => {
  assert.equal(resolve("text/plain", "files"), "ideall.preview")
  assert.equal(resolve("text/plain", "development"), "ideall.code")
  assert.equal(resolve("text/plain", "audio"), "ideall.preview")
  assert.equal(resolve("audio/mpeg", "files"), "ideall.preview")
  assert.equal(resolve("audio/mpeg", "audio"), "ideall.audio")
})

test("workspace engine: 语义专用引擎不被开发工作区覆盖", () => {
  assert.equal(resolve("text/uri-list", "development"), "ideall.browser")
  assert.equal(resolve("application/vnd.ideall.audio+json", "files"), "ideall.audio")
  assert.equal(resolve("application/vnd.ideall.audio+json", "audio"), "ideall.audio")
  assert.equal(resolve("application/vnd.ideall.audio+json", "development"), "ideall.audio")
})
