import { test } from "node:test"
import assert from "node:assert/strict"
import type { IdeallFile } from "@protocol/file-system"
import { registerBuiltInEngines, engineRegistry } from "@/engines/builtin"
import { filterRemovedEngineAssociations } from "@/engines/registry"
import {
  emptyEnginePreferences,
  withEngineAssociationRemoved,
  type EnginePreferences,
} from "@/engines/preferences"
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

/** 与 src/workspace/store/navigation.ts 打开路径同形：先偏好过滤，再工作区替换。 */
function resolveViaNavigationPath(
  mediaType: string,
  workspace: "files" | "audio" | "development",
  preferences: EnginePreferences,
) {
  const target = file(mediaType)
  const candidates = filterRemovedEngineAssociations(
    engineRegistry.matching(target),
    preferences,
    target.mediaType,
  )
  return resolveWorkspaceEngine(
    target,
    workspace,
    candidates,
    engineRegistry.resolve(target, preferences),
  )?.descriptor.engineId
}

test("workspace engine: removed associations 屏蔽不被工作区默认引擎替换复活", () => {
  // audio 工作区屏蔽 ideall.audio：替换不得捞回，落到未被屏蔽的通用预览。
  const audioBlocked = withEngineAssociationRemoved(
    emptyEnginePreferences(),
    "audio/mpeg",
    "ideall.audio",
  )
  assert.equal(resolveViaNavigationPath("audio/mpeg", "audio", audioBlocked), "ideall.preview")

  // development 工作区屏蔽 ideall.code：替换不得捞回。
  const codeBlocked = withEngineAssociationRemoved(
    emptyEnginePreferences(),
    "text/plain",
    "ideall.code",
  )
  assert.equal(resolveViaNavigationPath("text/plain", "development", codeBlocked), "ideall.preview")

  // files 工作区屏蔽 ideall.preview：generic 回退不得捞回 preview。
  const previewBlocked = withEngineAssociationRemoved(
    emptyEnginePreferences(),
    "text/plain",
    "ideall.preview",
  )
  assert.equal(resolveViaNavigationPath("text/plain", "files", previewBlocked), "ideall.code")

  // 未屏蔽时三场景行为不变（与既有默认解析一致）。
  assert.equal(
    resolveViaNavigationPath("audio/mpeg", "audio", emptyEnginePreferences()),
    "ideall.audio",
  )
  assert.equal(
    resolveViaNavigationPath("text/plain", "development", emptyEnginePreferences()),
    "ideall.code",
  )
})
