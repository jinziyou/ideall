import assert from "node:assert/strict"
import { test } from "node:test"
import { createCollection } from "./agent-collection"

test("agent collection: strict persistence publishes only after durable setItem", () => {
  const previous = globalThis.localStorage
  let fail = false
  const writes: string[] = []
  const storage = {
    getItem: () => null,
    setItem: (_key: string, value: string) => {
      if (fail) throw new Error("quota exceeded")
      writes.push(value)
    },
  } as unknown as Storage
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })
  try {
    const collection = createCollection<{ id: string }>("strict-test", () => [], undefined, {
      persistence: "strict",
    })
    let notifications = 0
    collection.subscribe(() => notifications++)
    collection.upsert({ id: "durable" })
    assert.deepEqual(collection.get(), [{ id: "durable" }])
    assert.equal(notifications, 1)
    assert.equal(writes.length, 1)

    fail = true
    assert.throws(() => collection.upsert({ id: "not-published" }), /quota exceeded/)
    assert.deepEqual(collection.get(), [{ id: "durable" }])
    assert.equal(notifications, 1)
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "localStorage")
    else Object.defineProperty(globalThis, "localStorage", { value: previous, configurable: true })
  }
})
