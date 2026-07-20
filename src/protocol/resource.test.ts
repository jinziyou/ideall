import { test } from "node:test"
import assert from "node:assert/strict"
import {
  isResourceKindForScheme,
  isResourceScheme,
  parseResourceKey,
  parseResourceSearch,
  resourceKey,
  resourceQueryValue,
  type ResourceRef,
} from "./resource"

test("resourceKey / parseResourceKey: 稳定编码并保留不透明 id", () => {
  const refs: ResourceRef[] = [
    { scheme: "node", kind: "note", id: "a:b/c?d&e=f" },
    { scheme: "info", kind: "entity", id: "人物:张三/CEO" },
    { scheme: "community", kind: "peer", id: "peer@example.com" },
    { scheme: "tool", kind: "search", id: "default" },
    { scheme: "browser", kind: "page", id: "https://example.com/a?b=c" },
    { scheme: "app", kind: "native-app", id: "org.example.App" },
  ]

  for (const ref of refs) {
    assert.deepEqual(parseResourceKey(resourceKey(ref)), ref)
  }
})

test("resourceQueryValue: 可安全嵌入 URL 查询参数", () => {
  const ref: ResourceRef = { scheme: "node", kind: "file", id: "%:/:?&=中文" }
  assert.deepEqual(parseResourceSearch(`?resource=${resourceQueryValue(ref)}`), ref)
})

test("parseResourceKey: 非法 scheme/kind/id 拒收", () => {
  assert.equal(parseResourceKey("bad:note:1"), null)
  assert.equal(parseResourceKey("node:bad:1"), null)
  assert.equal(parseResourceKey("node:note:"), null)
  assert.equal(parseResourceKey("node"), null)
  assert.equal(parseResourceKey("node:note:%"), null)
})

test("parseResourceSearch: 新 resource 优先, 兼容旧 node 查询", () => {
  const next: ResourceRef = { scheme: "info", kind: "publisher", id: "example.com" }
  assert.deepEqual(parseResourceSearch(`?node=note:old&resource=${resourceQueryValue(next)}`), next)
  assert.equal(parseResourceSearch("?node=thread:t1"), null)
})

test("resource kind guards: scheme 与 kind 均为闭合集合", () => {
  assert.equal(isResourceScheme("node"), true)
  assert.equal(isResourceScheme("unknown"), false)
  assert.equal(isResourceKindForScheme("node", "note"), true)
  assert.equal(isResourceKindForScheme("node", "entity"), false)
  assert.equal(isResourceKindForScheme("info", "entity"), true)
  assert.equal(isResourceKindForScheme("info", "note"), false)
})
