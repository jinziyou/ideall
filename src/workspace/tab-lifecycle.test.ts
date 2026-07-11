import assert from "node:assert/strict"
import { test } from "node:test"
import type { Tab, TabDescriptor } from "./types"
import {
  dirtyTabClosePolicy,
  evictColdTabs,
  planTabClose,
  planTransientTabOpen,
} from "./tab-lifecycle"
import { tabKey } from "./tab-key"

function descriptor(id: string, title = id): TabDescriptor {
  return { kind: "test", module: "home", title, params: { id } }
}

function tab(id: string, title = id): Tab {
  const value = descriptor(id, title)
  return { ...value, id: tabKey(value) }
}

test("tab lifecycle: transient open reuses the slot and never demotes an existing tab", () => {
  const existing = tab("existing")
  const preview = tab("preview")
  const next = descriptor("next")
  const replaced = planTransientTabOpen([existing, preview], preview.id, next)
  assert.deepEqual(
    replaced.tabs.map((item) => item.title),
    ["existing", "next"],
  )
  assert.equal(replaced.transientId, tabKey(next))

  const hit = planTransientTabOpen(replaced.tabs, replaced.transientId, descriptor("existing"))
  assert.equal(hit.tabs, replaced.tabs)
  assert.equal(hit.activeId, existing.id)
  assert.equal(hit.transientId, replaced.transientId)
})

test("tab lifecycle: eviction follows LRU while protecting preview, dirty, and new tabs", () => {
  const tabs = [tab("old"), tab("dirty"), tab("preview"), tab("new")]
  const result = evictColdTabs({
    tabs,
    transientId: tabs[2]?.id ?? null,
    lru: tabs.map((item) => item.id),
    dirtyIds: new Set([tabs[1]?.id ?? ""]),
    protectedIds: new Set([tabs[3]?.id ?? ""]),
    maxPermanentTabs: 2,
  })
  assert.deepEqual(
    result.map((item) => item.title),
    ["dirty", "preview", "new"],
  )
})

test("tab lifecycle: close selection prefers the right neighbor then the left", () => {
  const tabs = [tab("left"), tab("active"), tab("right")]
  const middle = planTabClose(tabs, tabs[1]?.id ?? null, null, tabs[1]?.id ?? "")
  assert.equal(middle?.nextActiveTab?.title, "right")
  const end = planTabClose(tabs, tabs[2]?.id ?? null, tabs[2]?.id ?? null, tabs[2]?.id ?? "")
  assert.equal(end?.nextActiveTab?.title, "active")
  assert.equal(end?.transientId, null)
})

test("tab lifecycle: dirty close policy preserves candidate order and caps displayed names", () => {
  const tabs = [tab("a", "A"), tab("b", "B"), tab("c", "C"), tab("d", "D")]
  const policy = dirtyTabClosePolicy(
    tabs,
    new Set(tabs.map((item) => item.id)),
    tabs.map((item) => item.id).reverse(),
  )
  assert.deepEqual(policy?.ids, tabs.map((item) => item.id).reverse())
  assert.equal(
    policy?.description,
    "「A」、「B」、「C」等 4 个标签 有未保存更改，关闭后会丢失这些更改。",
  )
})
