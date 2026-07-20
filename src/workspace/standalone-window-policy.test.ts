import assert from "node:assert/strict"
import { test } from "node:test"
import { canOpenStandaloneWindow } from "./standalone-window-policy"

test("standalone window requires permission from both file and engine", () => {
  assert.equal(
    canOpenStandaloneWindow(
      { capabilities: ["read", "standalone-window"] },
      { supportsStandaloneWindow: true },
    ),
    true,
  )
  assert.equal(
    canOpenStandaloneWindow({ capabilities: ["read"] }, { supportsStandaloneWindow: true }),
    false,
  )
  assert.equal(
    canOpenStandaloneWindow(
      { capabilities: ["standalone-window"] },
      { supportsStandaloneWindow: false },
    ),
    false,
  )
})
