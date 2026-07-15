import { test } from "node:test"
import assert from "node:assert/strict"
import { BrowserNativeLifecycle } from "./browser-native-lifecycle"

test("browser native lifecycle: duplicate releases share one native operation", async () => {
  const lifecycle = new BrowserNativeLifecycle()
  let releases = 0
  let finish = () => {}
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const first = lifecycle.release(async () => {
    releases += 1
    await pending
  })
  const second = lifecycle.release(async () => {
    releases += 1
  })
  assert.equal(first, second)
  finish()
  await Promise.all([first, second])
  await lifecycle.release(async () => {
    releases += 1
  })
  assert.equal(releases, 1)
})

test("browser native lifecycle: the latest activation/release order wins", async () => {
  const lifecycle = new BrowserNativeLifecycle()
  const operations: string[] = []
  const firstRelease = lifecycle.release(async () => {
    operations.push("release-1")
  })
  const activate = lifecycle.activate(async () => {
    operations.push("activate")
  })
  const lastRelease = lifecycle.release(async () => {
    operations.push("release-2")
  })
  await Promise.all([firstRelease, activate, lastRelease])
  assert.deepEqual(operations, ["release-1", "activate", "release-2"])
})
