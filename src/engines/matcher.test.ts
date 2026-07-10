import assert from "node:assert/strict"
import { test } from "node:test"
import type { EngineDescriptor } from "@protocol/engine"
import type { IdeallFile } from "@protocol/file-system"
import { matchEngineDescriptor, matchMediaTypePattern, normalizeMediaType } from "./matcher"

const file: IdeallFile = {
  ref: { fileSystemId: "local", fileId: "notes/readme" },
  kind: "file",
  name: "README.md",
  mediaType: "text/markdown; charset=utf-8",
  capabilities: ["read", "write"],
  source: { kind: "local", id: "local" },
  properties: { language: "markdown", git: true },
}

function descriptor(match: EngineDescriptor["match"]): EngineDescriptor {
  return {
    engineId: "test.engine",
    label: "Test",
    match,
    layout: "fill",
    access: "read-write",
  }
}

test("engine matcher: media type 归一化并按精确度匹配 glob", () => {
  assert.equal(normalizeMediaType(" Text/Markdown; charset=UTF-8 "), "text/markdown")
  assert.equal(matchMediaTypePattern("text/markdown", file.mediaType), 400)
  assert.ok(matchMediaTypePattern("text/*", file.mediaType)! > 1)
  assert.ok(matchMediaTypePattern("*/markdown", file.mediaType)! > 1)
  assert.equal(matchMediaTypePattern("audio/*", file.mediaType), null)
  assert.equal(matchMediaTypePattern("*/*", file.mediaType), 1)
})

test("engine matcher: kind、capability 与 properties 必须全部满足", () => {
  const result = matchEngineDescriptor(
    descriptor({
      kinds: ["file"],
      mediaTypes: ["text/*"],
      requiredCapabilities: ["read", "write"],
      properties: { language: "markdown", git: true },
    }),
    file,
  )
  assert.ok(result)
  assert.ok(result.specificity > 0)

  assert.equal(matchEngineDescriptor(descriptor({ requiredCapabilities: ["delete"] }), file), null)
  assert.equal(matchEngineDescriptor(descriptor({ properties: { git: false } }), file), null)
  assert.equal(matchEngineDescriptor(descriptor({ kinds: ["directory"] }), file), null)
})

test("engine matcher: 无约束 descriptor 是最低特异度的通用后备", () => {
  assert.deepEqual(matchEngineDescriptor(descriptor(undefined), file), {
    descriptor: descriptor(undefined),
    specificity: 0,
  })
  assert.equal(matchEngineDescriptor(descriptor({ mediaTypes: [] }), file), null)
})
