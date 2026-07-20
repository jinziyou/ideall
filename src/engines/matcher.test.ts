import assert from "node:assert/strict"
import { test } from "node:test"
import type { EngineDescriptor } from "@protocol/engine"
import type { IdeallFile } from "@protocol/file-system"
import {
  SUBCLASS_DISTANCE_PENALTY,
  matchEngineDescriptor,
  matchMediaTypePattern,
  normalizeMediaType,
} from "./matcher"

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

test("engine matcher: subclass 父链命中按距离折损且抢不过直接命中", () => {
  // application/yaml 经父类 text/plain 命中 text/*（距离 1：205-150=55）。
  assert.equal(matchMediaTypePattern("text/*", "application/yaml"), 205 - SUBCLASS_DISTANCE_PENALTY)
  // application/ld+json 经父类 application/json 精确命中（距离 1：400-150=250）。
  assert.equal(
    matchMediaTypePattern("application/json", "application/ld+json"),
    400 - SUBCLASS_DISTANCE_PENALTY,
  )
  // text/markdown 经父类 text/plain 精确命中（距离 1：250）。
  assert.equal(
    matchMediaTypePattern("text/plain", "text/markdown"),
    400 - SUBCLASS_DISTANCE_PENALTY,
  )
  // 直接命中不折损：text/markdown 对 text/* 是直接类型通配（205）。
  assert.equal(matchMediaTypePattern("text/*", "text/markdown"), 205)
  // 父链命中的类型通配仅高于全通配：application/json 经父类 text/plain 命中 text/*（55）。
  assert.equal(matchMediaTypePattern("text/*", "application/json"), 205 - SUBCLASS_DISTANCE_PENALTY)
  // 距离 ≥2 的类型通配折损为负：ld+json 不能经祖父 text/plain 命中 text/*。
  assert.equal(matchMediaTypePattern("text/*", "application/ld+json"), null)
  // 父链与模式无关方向不命中。
  assert.equal(matchMediaTypePattern("application/json", "application/yaml"), null)
  assert.equal(matchMediaTypePattern("audio/*", "application/yaml"), null)
  assert.equal(matchMediaTypePattern("text/*", "application/x-unknown-thing"), null)
})

test("engine matcher: vnd.ideall 语义类型不进父链，隔离性不被层级穿透", () => {
  // 语义 panel JSON 不能被 code 的 application/json 经 +json 隐式联想捕获（无隐式 suffix 规则）。
  assert.equal(
    matchMediaTypePattern("application/json", "application/vnd.ideall.panel.settings+json"),
    null,
  )
  assert.equal(matchMediaTypePattern("text/*", "application/vnd.ideall.note+json"), null)
  assert.equal(matchMediaTypePattern("application/json", "application/vnd.ideall.note+json"), null)
})
