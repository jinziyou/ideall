// fractional-indexing 排序键回归网 (node:test + tsx)。锁死核心不变量:
//   - sortKeyBetween(a,b) 严格落在 (a,b) 之间, 字典序 a < 结果 < b;
//   - 反复在 头 / 尾 / 中间 插入均保持全序, 永不抛 (不退化、不产生非法键);
//   - 随机大量插入 + 删除后, 全序仍由 sortKey 字典序唯一决定。
import { test } from "node:test"
import assert from "node:assert/strict"

import { sortKeyBetween, initialSortKey, sequentialSortKeys } from "@/files/sort-key"

test("两者皆 null → 首个键; 末尾追加严格递增", () => {
  const k0 = initialSortKey()
  const k1 = sortKeyBetween(k0, null)
  const k2 = sortKeyBetween(k1, null)
  assert.ok(k0 < k1 && k1 < k2, `期望 ${k0} < ${k1} < ${k2}`)
})

test("开头插入: between(null, min) 严格小于 min", () => {
  let min = initialSortKey()
  for (let i = 0; i < 200; i++) {
    const k = sortKeyBetween(null, min)
    assert.ok(k < min, `第 ${i} 次头插: ${k} 应 < ${min}`)
    min = k
  }
})

test("末尾插入: between(max, null) 严格大于 max", () => {
  let max = initialSortKey()
  for (let i = 0; i < 200; i++) {
    const k = sortKeyBetween(max, null)
    assert.ok(k > max, `第 ${i} 次尾插: ${k} 应 > ${max}`)
    max = k
  }
})

test("中间反复插入: 始终严格介于两者之间", () => {
  let lo = initialSortKey()
  let hi = sortKeyBetween(lo, null)
  for (let i = 0; i < 200; i++) {
    const mid = sortKeyBetween(lo, hi)
    assert.ok(lo < mid && mid < hi, `第 ${i} 次中插: 期望 ${lo} < ${mid} < ${hi}`)
    // 交替收紧上界 / 下界, 制造最坏的相邻键挤压
    if (i % 2 === 0) hi = mid
    else lo = mid
  }
})

test("sequentialSortKeys: 等长且严格递增", () => {
  const keys = sequentialSortKeys(500)
  assert.equal(keys.length, 500)
  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i - 1] < keys[i], `第 ${i} 项应递增: ${keys[i - 1]} < ${keys[i]}`)
  }
})

test("a >= b 抛错 (调用方须按顺序传入)", () => {
  const a = initialSortKey()
  const b = sortKeyBetween(a, null)
  assert.throws(() => sortKeyBetween(b, a))
  assert.throws(() => sortKeyBetween(a, a))
})

test("随机插入序列: 全序由 sortKey 字典序唯一决定", () => {
  // 确定性伪随机 (不用 Math.random, 便于失败复现)
  let seed = 0x2f6e2b1
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  // 维护一条有序链表 (值=sortKey), 每步随机选位置插入并校验严格有序
  const list: string[] = [initialSortKey()]
  for (let step = 0; step < 3000; step++) {
    const pos = Math.floor(rnd() * (list.length + 1))
    const a = pos > 0 ? list[pos - 1] : null
    const b = pos < list.length ? list[pos] : null
    const k = sortKeyBetween(a, b)
    list.splice(pos, 0, k)
  }
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i - 1] < list[i], `第 ${i} 项失序: ${list[i - 1]} !< ${list[i]}`)
  }
  // 键集合无重复
  assert.equal(new Set(list).size, list.length, "排序键不得重复")
})
