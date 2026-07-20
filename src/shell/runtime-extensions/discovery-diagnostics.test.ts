import assert from "node:assert/strict"
import { test } from "node:test"
import {
  replaceRuntimeExtensionPackageRejections,
  runtimeExtensionPackageRejections,
  subscribeRuntimeExtensionPackageRejections,
} from "./discovery-diagnostics"

test("runtime extension rejection diagnostics are immutable, sorted and only notify on changes", () => {
  replaceRuntimeExtensionPackageRejections([])
  let notifications = 0
  const dispose = subscribeRuntimeExtensionPackageRejections(() => {
    notifications += 1
  })
  const source = [
    { directory: "z.connector", code: "invalid-signature" },
    { directory: "a.connector", code: "connector-digest-mismatch" },
  ]

  replaceRuntimeExtensionPackageRejections(source)
  source[0].code = "changed-after-publication"
  assert.deepEqual(runtimeExtensionPackageRejections(), [
    { directory: "a.connector", code: "connector-digest-mismatch" },
    { directory: "z.connector", code: "invalid-signature" },
  ])
  assert.equal(notifications, 1)

  replaceRuntimeExtensionPackageRejections(runtimeExtensionPackageRejections())
  assert.equal(notifications, 1)
  dispose()
  replaceRuntimeExtensionPackageRejections([])
})
