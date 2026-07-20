import assert from "node:assert/strict"
import test from "node:test"

import { CURRENT_DATA_EPOCH, DATA_EPOCH_STORAGE_KEY, ensureCurrentDataEpoch } from "./data-epoch"

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  let clears = 0
  return {
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      clear: () => {
        clears += 1
        values.clear()
      },
    },
    values,
    get clears() {
      return clears
    },
  }
}

test("data epoch: current baseline is explicit and versioned", () => {
  assert.equal(DATA_EPOCH_STORAGE_KEY, "ideall:data-epoch")
  assert.equal(CURRENT_DATA_EPOCH, "2")
})

test("data epoch: current installation performs no cleanup", async () => {
  const local = memoryStorage({ [DATA_EPOCH_STORAGE_KEY]: CURRENT_DATA_EPOCH })
  const session = memoryStorage({ draft: "keep" })
  let durableCleanup = 0
  const result = await ensureCurrentDataEpoch({
    local: local.storage,
    session: session.storage,
    deleteDatabases: async () => void (durableCleanup += 1),
    deleteSecrets: async () => void (durableCleanup += 1),
  })
  assert.equal(result, "current")
  assert.equal(durableCleanup, 0)
  assert.equal(local.clears, 0)
  assert.equal(session.clears, 0)
})

test("data epoch: incompatible installation is cleared once and marked current", async () => {
  const local = memoryStorage({ old: "value" })
  const session = memoryStorage({ draft: "value" })
  const calls: string[] = []
  assert.equal(
    await ensureCurrentDataEpoch({
      local: local.storage,
      session: session.storage,
      deleteDatabases: async () => void calls.push("databases"),
      deleteSecrets: async () => void calls.push("secrets"),
    }),
    "reset",
  )
  assert.deepEqual(calls, ["secrets", "databases"])
  assert.equal(local.clears, 1)
  assert.equal(session.clears, 1)
  assert.deepEqual([...local.values], [[DATA_EPOCH_STORAGE_KEY, CURRENT_DATA_EPOCH]])
})

test("data epoch: failed durable cleanup does not advance the marker", async () => {
  const local = memoryStorage({ old: "value" })
  const session = memoryStorage()
  await assert.rejects(
    ensureCurrentDataEpoch({
      local: local.storage,
      session: session.storage,
      deleteDatabases: async () => undefined,
      deleteSecrets: async () => {
        throw new Error("keychain unavailable")
      },
    }),
    /keychain unavailable/,
  )
  assert.equal(local.values.get(DATA_EPOCH_STORAGE_KEY), undefined)
  assert.equal(local.values.get("old"), "value")
})
