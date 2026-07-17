import assert from "node:assert/strict"
import { test } from "node:test"
import {
  MAX_MEDIA_TYPE_ANCESTORS,
  MEDIA_TYPE_PARENTS,
  mediaTypeAncestors,
  mediaTypeAncestorsWithDistance,
  normalizeMediaType,
} from "./media-type-tree"

test("media type tree: 父链 BFS 近亲优先且带距离", () => {
  assert.deepEqual(mediaTypeAncestorsWithDistance("application/ld+json"), [
    { mediaType: "application/json", distance: 1 },
    { mediaType: "text/plain", distance: 2 },
  ])
  assert.deepEqual(mediaTypeAncestors("text/markdown"), ["text/plain"])
  assert.deepEqual(mediaTypeAncestors("image/svg+xml"), ["application/xml", "text/plain"])
})

test("media type tree: 输入先归一化，未知类型与空值无父链", () => {
  assert.deepEqual(mediaTypeAncestors(" Application/LD+JSON; charset=utf-8 "), [
    "application/json",
    "text/plain",
  ])
  assert.deepEqual(mediaTypeAncestors("application/x-unknown-thing"), [])
  assert.deepEqual(mediaTypeAncestors("audio/*"), [])
  assert.deepEqual(mediaTypeAncestors(""), [])
  assert.deepEqual(mediaTypeAncestors("text/plain"), [])
})

test("media type tree: 表卫生——键值归一、无通配、无 vnd.ideall 语义类型、无环且数量有界", () => {
  for (const [type, parents] of Object.entries(MEDIA_TYPE_PARENTS)) {
    assert.equal(type, normalizeMediaType(type), `键未归一: ${type}`)
    assert.ok(!type.includes("*"), `键含通配: ${type}`)
    assert.ok(!type.startsWith("application/vnd.ideall."), `语义类型不得进表: ${type}`)
    assert.ok(parents.length > 0, `空父类: ${type}`)
    for (const parent of parents) {
      assert.equal(parent, normalizeMediaType(parent), `父类未归一: ${parent}`)
      assert.ok(!parent.includes("*"), `父类含通配: ${parent}`)
      assert.ok(!parent.startsWith("application/vnd.ideall."), `语义类型不得作父类: ${parent}`)
    }
    // 无环（含自环）且链长有界：从任意键出发的祖先枚举必须在封顶内终止。
    const ancestors = mediaTypeAncestorsWithDistance(type)
    assert.ok(ancestors.length <= MAX_MEDIA_TYPE_ANCESTORS)
    assert.ok(!ancestors.some((ancestor) => ancestor.mediaType === type), `父链含自身: ${type}`)
  }
})
