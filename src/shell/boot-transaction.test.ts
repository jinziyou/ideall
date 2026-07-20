import assert from "node:assert/strict"
import { test } from "node:test"
import { runRegistrationTransaction } from "./boot-transaction"

test("registration transaction rolls completed steps back in reverse order", () => {
  const events: string[] = []
  assert.throws(
    () =>
      runRegistrationTransaction([
        () => {
          events.push("register:first")
          return () => events.push("dispose:first")
        },
        () => {
          events.push("register:second")
          return () => events.push("dispose:second")
        },
        () => {
          throw new Error("boom")
        },
      ]),
    /boom/,
  )
  assert.deepEqual(events, ["register:first", "register:second", "dispose:second", "dispose:first"])
})

test("registration transaction can retry after failure and dispose once", () => {
  let attempts = 0
  let active = 0
  const step = () => {
    attempts += 1
    active += 1
    return () => {
      active -= 1
    }
  }
  assert.throws(() =>
    runRegistrationTransaction([
      step,
      () => {
        throw new Error("retry")
      },
    ]),
  )
  assert.equal(active, 0)

  const dispose = runRegistrationTransaction([step])
  assert.equal(active, 1)
  dispose()
  dispose()
  assert.equal(active, 0)
  assert.equal(attempts, 2)
})
