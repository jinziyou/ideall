import assert from "node:assert/strict"
import { test } from "node:test"
import {
  getBrowserBackend,
  getBrowserUrl,
  setBrowserBackend,
  setBrowserUrl,
  subscribeBrowserState,
} from "./browser-state"

test("browser state: publishes URL and backend changes for context candidates", () => {
  let updates = 0
  const dispose = subscribeBrowserState(() => updates++)
  setBrowserUrl("https://example.com/context")
  setBrowserBackend("webkit")
  setBrowserUrl("https://example.com/context")
  dispose()

  assert.equal(getBrowserUrl(), "https://example.com/context")
  assert.equal(getBrowserBackend(), "webkit")
  assert.equal(updates, 2)
})
