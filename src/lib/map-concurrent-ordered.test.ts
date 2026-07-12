import assert from "node:assert/strict"
import { test } from "node:test"
import { mapConcurrentOrdered } from "./map-concurrent-ordered"

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

test("mapConcurrentOrdered preserves input order and bounds concurrency", async () => {
  const completions = new Map<number, () => void>()
  const started: number[] = []
  let active = 0
  let peak = 0

  const pending = mapConcurrentOrdered([0, 1, 2, 3], 2, async (value) => {
    started.push(value)
    active += 1
    peak = Math.max(peak, active)
    await new Promise<void>((resolve) => completions.set(value, resolve))
    active -= 1
    return value * 10
  })

  const complete = (value: number) => {
    const resolve = completions.get(value)
    assert.ok(resolve)
    resolve()
  }

  assert.deepEqual(started, [0, 1])
  complete(1)
  await nextTurn()
  assert.deepEqual(started, [0, 1, 2])
  complete(2)
  await nextTurn()
  assert.deepEqual(started, [0, 1, 2, 3])
  complete(3)
  complete(0)

  assert.deepEqual(await pending, [0, 10, 20, 30])
  assert.equal(peak, 2)
})

test("mapConcurrentOrdered stops scheduling and throws the earliest input failure", async () => {
  const first = deferred()
  const second = deferred()
  const firstError = new Error("first input failed")
  const laterError = new Error("later input failed first")
  const started: number[] = []

  const pending = mapConcurrentOrdered([0, 1, 2, 3, 4], 3, async (value) => {
    started.push(value)
    if (value === 0) {
      await first.promise
      throw firstError
    }
    if (value === 1) {
      await second.promise
      return value
    }
    throw laterError
  })

  await nextTurn()
  first.resolve()
  second.resolve()

  await assert.rejects(pending, (error) => error === firstError)
  assert.deepEqual(started, [0, 1, 2])
})
