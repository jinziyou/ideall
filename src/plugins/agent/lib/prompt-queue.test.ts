import { test } from "node:test"
import assert from "node:assert/strict"
import { PromptQueue } from "./prompt-queue"

test("push 后 next 按 FIFO 返回", async () => {
  const q = new PromptQueue()
  q.push("a")
  q.push("b")
  assert.equal(await q.next(), "a")
  assert.equal(await q.next(), "b")
})

test("next 等待稍后的 push", async () => {
  const q = new PromptQueue()
  const pending = q.next()
  q.push("x")
  assert.equal(await pending, "x")
})

test("close 唤醒等待者并返回 null", async () => {
  const q = new PromptQueue()
  const pending = q.next()
  q.close()
  assert.equal(await pending, null)
})

test("close 后 next 立即 null、push 被忽略", async () => {
  const q = new PromptQueue()
  q.close()
  q.push("ignored")
  assert.equal(await q.next(), null)
})

test("已缓冲项先排空再 close-null", async () => {
  const q = new PromptQueue()
  q.push("a")
  q.close()
  assert.equal(await q.next(), "a")
  assert.equal(await q.next(), null)
})

test("close 幂等", () => {
  const q = new PromptQueue()
  q.close()
  q.close()
})
