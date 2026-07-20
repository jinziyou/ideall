import assert from "node:assert/strict"
import { test } from "node:test"
import type { TrashFileItem } from "@/filesystem/trash-file-system"
import {
  createTrashEmptyConfirmationRequestGate,
  prepareTrashEmptyConfirmation,
} from "./trash-empty-confirmation"

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("trash empty confirmation: async versioning keeps the click-time snapshot", async () => {
  const items: TrashFileItem[] = [
    {
      id: "confirmed",
      kind: "note",
      title: "Confirmed",
      deletedAt: 10,
      updatedAt: 11,
      parentId: null,
      tags: [],
      restorable: true,
      snapshot: true,
      detail: "snapshot",
    },
  ]
  const version = deferred<string>()
  let captured: readonly Pick<TrashFileItem, "id" | "kind" | "updatedAt" | "deletedAt">[] = []
  const preparing = prepareTrashEmptyConfirmation(items, (snapshot) => {
    captured = snapshot
    return version.promise
  })

  items[0]!.id = "refreshed"
  items.push({ ...items[0]!, id: "late", title: "Late" })
  version.resolve("trash-v2:frozen")

  assert.deepEqual(await preparing, {
    kind: "empty",
    expectedVersion: "trash-v2:frozen",
    count: 1,
  })
  assert.deepEqual(captured, [{ id: "confirmed", kind: "note", updatedAt: 11, deletedAt: 10 }])
  assert.equal(Object.isFrozen(captured), true)
  assert.equal(Object.isFrozen(captured[0]), true)
})

test("trash empty confirmation: another action invalidates a pending digest", async () => {
  const gate = createTrashEmptyConfirmationRequestGate()
  const version = deferred<string>()
  const request = gate.begin()
  const preparing = prepareTrashEmptyConfirmation([], () => version.promise)

  gate.cancel()
  version.resolve("trash-v2:late")

  assert.deepEqual(await preparing, {
    kind: "empty",
    expectedVersion: "trash-v2:late",
    count: 0,
  })
  assert.equal(gate.isCurrent(request), false)

  const next = gate.begin()
  assert.equal(gate.isCurrent(next), true)
})
