import assert from "node:assert/strict"
import { test } from "node:test"
import { fileRefKey, type FileRef } from "@protocol/file-system"
import { KeyedPromiseMutex, withFileWriteLock } from "./write-lock"

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

test("KeyedPromiseMutex serializes equal keys and removes idle tails", async () => {
  const mutex = new KeyedPromiseMutex()
  const firstEntered = deferred()
  const releaseFirst = deferred()
  const order: string[] = []

  const first = mutex.runExclusive("same", async () => {
    order.push("first:start")
    firstEntered.resolve()
    await releaseFirst.promise
    order.push("first:end")
  })
  await firstEntered.promise
  const second = mutex.runExclusive("same", () => {
    order.push("second")
  })

  await Promise.resolve()
  assert.deepEqual(order, ["first:start"])
  assert.equal(mutex.pendingKeyCount, 1)
  releaseFirst.resolve()
  await Promise.all([first, second])
  assert.deepEqual(order, ["first:start", "first:end", "second"])
  assert.equal(mutex.pendingKeyCount, 0)
})

test("KeyedPromiseMutex releases synchronous throws and asynchronous rejections", async () => {
  const mutex = new KeyedPromiseMutex()
  await assert.rejects(
    mutex.runExclusive("same", () => {
      throw new Error("failed write")
    }),
    /failed write/,
  )
  assert.equal(mutex.pendingKeyCount, 0)
  await assert.rejects(
    mutex.runExclusive("same", async () => {
      throw new Error("rejected write")
    }),
    /rejected write/,
  )
  assert.equal(mutex.pendingKeyCount, 0)
  assert.equal(await mutex.runExclusive("same", () => "next write"), "next write")
  assert.equal(mutex.pendingKeyCount, 0)
})

test("withFileWriteLock prefers a same-origin Web Lock keyed by FileRef", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")
  const requested: string[] = []
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        async request<T>(name: string, callback: () => T | Promise<T>): Promise<T> {
          requested.push(name)
          return callback()
        },
      },
    },
  })

  const ref: FileRef = { fileSystemId: "test fs", fileId: "file/1" }
  try {
    assert.equal(await withFileWriteLock(ref, () => "written"), "written")
    assert.equal(await withFileWriteLock(ref, () => "again"), "again")
    assert.equal(requested.length, 2)
    assert.equal(requested[0], requested[1])
    assert.match(requested[0], /^ideall:file-write:[a-f0-9]{64}$/)
    assert.equal(requested[0].includes(fileRefKey(ref)), false)
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator)
    else Reflect.deleteProperty(globalThis, "navigator")
  }
})

test("withFileWriteLock falls back only when a Web Lock fails before granting", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")
  let operations = 0
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        async request(): Promise<never> {
          throw new Error("unsupported")
        },
      },
    },
  })

  try {
    const ref: FileRef = { fileSystemId: "test", fileId: "fallback" }
    const result = await withFileWriteLock(ref, () => ++operations)
    assert.equal(result, 1)
    assert.equal(operations, 1)
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator)
    else Reflect.deleteProperty(globalThis, "navigator")
  }
})
