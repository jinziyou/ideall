import assert from "node:assert/strict"
import { test } from "node:test"
import type { FileRef } from "@protocol/file-system"
import {
  THUMBNAIL_MAX_ENTRIES,
  clearThumbnailCache,
  defaultThumbnailDecoder,
  getThumbnail,
  thumbnailCacheKey,
  thumbnailCacheSize,
} from "./thumbnail-cache"

const ref: FileRef = { fileSystemId: "ideall.core", fileId: "node:file:img-1" }

function blobOf(content: string): Blob {
  return new Blob([content], { type: "image/png" })
}

function fakeDecode(
  prefix = "thumb",
): (blob: Blob, maxDimension: number) => Promise<string | null> {
  return async (blob, maxDimension) => {
    const text = await blob.text()
    return `${prefix}:${text}:${maxDimension}`
  }
}

test("thumbnail cache: 命中复用同一 Promise,dataURL 含降采样上限", async () => {
  clearThumbnailCache()
  let loads = 0
  const load = async () => {
    loads += 1
    return blobOf("img-bytes")
  }
  const first = await getThumbnail(ref, "v1", load, fakeDecode())
  const second = await getThumbnail(ref, "v1", load, fakeDecode())
  assert.equal(loads, 1)
  assert.equal(first, "thumb:img-bytes:320")
  assert.equal(second, first)
  assert.equal(thumbnailCacheSize(), 1)
})

test("thumbnail cache: key=(ref,version)——版本推进自然命中新 key,旧版本各自独立", async () => {
  clearThumbnailCache()
  let loads = 0
  const load = async () => {
    loads += 1
    return blobOf(`v${loads}`)
  }
  const decode = async (blob: Blob) => blob.text()
  const v1 = await getThumbnail(ref, "v1", load, decode)
  const v2 = await getThumbnail(ref, "v2", load, decode)
  assert.equal(loads, 2)
  assert.notEqual(v1, v2)
  assert.notEqual(thumbnailCacheKey(ref, "v1"), thumbnailCacheKey(ref, "v2"))
  // 无版本目标按 null 段独立缓存。
  const noVersion = await getThumbnail(ref, null, load, decode)
  assert.ok(noVersion)
  assert.equal(thumbnailCacheSize(), 3)
})

test("thumbnail cache: 在途去重——并发取数只触发一次 load", async () => {
  clearThumbnailCache()
  let loads = 0
  let release: (() => void) | null = null
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const load = async () => {
    loads += 1
    await gate
    return blobOf("in-flight")
  }
  const decode = async (blob: Blob) => blob.text()
  const first = getThumbnail(ref, "v1", load, decode)
  const second = getThumbnail(ref, "v1", load, decode)
  assert.equal(loads, 1)
  release!()
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult, "in-flight")
  assert.equal(secondResult, "in-flight")
})

test("thumbnail cache: 失败不缓存——下次调用重新加载", async () => {
  clearThumbnailCache()
  let loads = 0
  const load = async () => {
    loads += 1
    return blobOf("x")
  }
  assert.equal(await getThumbnail(ref, "v1", load, async () => null), null)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(thumbnailCacheSize(), 0)
  assert.equal(await getThumbnail(ref, "v1", load, fakeDecode()), "thumb:x:320")
  assert.equal(loads, 2)
  // 读取异常同样不缓存。
  const failing = async () => {
    throw new Error("io")
  }
  assert.equal(
    await getThumbnail({ fileSystemId: "a", fileId: "b" }, "v1", failing, fakeDecode()),
    null,
  )
})

test("thumbnail cache: LRU 容量封顶,最旧条目被淘汰且命中可续命", async () => {
  clearThumbnailCache()
  const decode = fakeDecode()
  const loadOf = (name: string) => async () => blobOf(name)
  for (let index = 0; index < THUMBNAIL_MAX_ENTRIES; index += 1) {
    const itemRef = { fileSystemId: "fs", fileId: `f-${index}` }
    await getThumbnail(itemRef, "v1", loadOf(`f-${index}`), decode)
  }
  assert.equal(thumbnailCacheSize(), THUMBNAIL_MAX_ENTRIES)
  // 命中最旧条目使其续命,新条目淘汰次旧者。
  const oldestRef = { fileSystemId: "fs", fileId: "f-0" }
  await getThumbnail(oldestRef, "v1", loadOf("f-0"), decode)
  const newRef = { fileSystemId: "fs", fileId: "f-new" }
  await getThumbnail(newRef, "v1", loadOf("new"), decode)
  assert.equal(thumbnailCacheSize(), THUMBNAIL_MAX_ENTRIES)
  let reloads = 0
  const reloadOf = (name: string) => async () => {
    reloads += 1
    return blobOf(name)
  }
  // f-0 已续命仍命中;f-1 已被淘汰需重新加载。
  await getThumbnail(oldestRef, "v1", reloadOf("f-0"), decode)
  assert.equal(reloads, 0)
  await getThumbnail({ fileSystemId: "fs", fileId: "f-1" }, "v1", reloadOf("f-1"), decode)
  assert.equal(reloads, 1)
})

test("thumbnail cache: GIF 短路返回 null（走原图回退，不降采样为静态图）", async () => {
  // GIF guard 在 createImageBitmap 之前触发，node 无 canvas 也可验证。
  assert.equal(
    await defaultThumbnailDecoder(new Blob(["GIF89a"], { type: "image/gif" }), 320),
    null,
  )
})
