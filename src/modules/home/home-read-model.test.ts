import { test } from "node:test"
import assert from "node:assert/strict"
import type { Subscription } from "@protocol/subscription"
import { buildHomeActivity, createHomeOverviewData } from "./home-read-model"

function sub(input: Partial<Subscription> & Pick<Subscription, "id" | "type" | "createdAt">) {
  return {
    key: input.id,
    title: input.id,
    updatedAt: input.createdAt,
    ...input,
  } as Subscription
}

test("createHomeOverviewData: 聚合本地区段计数, 工具关注不计入关注数", () => {
  const data = createHomeOverviewData({
    subs: [
      sub({ id: "publisher:a", type: "publisher", createdAt: 1 }),
      sub({ id: "tool:x", type: "tool", createdAt: 2 }),
    ],
    bookmarks: [{ id: "b1", title: "B", createdAt: 3 }],
    files: [{ id: "f1", name: "a.txt", type: "text/plain", createdAt: 4 }],
    notes: [{ id: "n1", title: "N", createdAt: 5 }],
    threads: [{ id: "t1" }, { id: "t2" }],
  })

  assert.deepEqual(data.counts, {
    subscriptions: 1,
    bookmarks: 1,
    resources: 1,
    notes: 1,
    workspace: 2,
  })
})

test("buildHomeActivity: 按时间倒序合并最近动态并截断到 12 条", () => {
  const notes = Array.from({ length: 13 }, (_, index) => ({
    id: `n${index}`,
    title: index === 0 ? "" : `N${index}`,
    createdAt: index,
  }))

  const activity = buildHomeActivity({
    subs: [sub({ id: "publisher:a", type: "publisher", createdAt: 100 })],
    bookmarks: [{ id: "b1", title: "Bookmark", createdAt: 50 }],
    files: [{ id: "f1", name: "report.pdf", type: "application/pdf", createdAt: 75 }],
    notes,
  })

  assert.equal(activity.length, 12)
  assert.deepEqual(
    activity.slice(0, 3).map((item) => item.id),
    ["sub:publisher:a", "f:f1", "bm:b1"],
  )
  assert.deepEqual(activity[1].fileType, { name: "report.pdf", type: "application/pdf" })
  assert.ok(!activity.some((item) => item.title === "无标题"), "超出最近 12 条的旧笔记被截断")
})
