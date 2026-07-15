import assert from "node:assert/strict"
import { test } from "node:test"
import {
  classifyChangedPaths,
  immediateEventDecision,
  isBuildNeutralPath,
} from "./app-build-gate.mjs"

test("app build change classification keeps documentation-only pushes cheap", () => {
  const decision = classifyChangedPaths([
    "README.md",
    "docs/app.md",
    ".github/workflows/ci.yml",
    ".prettierrc.json",
  ])
  assert.deepEqual(decision, { build: false, rust: false, applicationPaths: [] })
})

test("the release workflow and shared setup action always exercise the app build", () => {
  assert.equal(isBuildNeutralPath(".github/workflows/app-build.yml"), false)
  assert.equal(isBuildNeutralPath(".github/actions/setup-js/action.yml"), false)
  assert.equal(isBuildNeutralPath(".github/workflows/smoke.yml"), true)

  const decision = classifyChangedPaths([".github/workflows/app-build.yml"])
  assert.equal(decision.build, true)
  assert.equal(decision.rust, false)
})

test("Rust changes request both the application and Rust gates", () => {
  const decision = classifyChangedPaths(["src-tauri/src/lib.rs"])
  assert.equal(decision.build, true)
  assert.equal(decision.rust, true)
})

test("tag and manual events are decided without consulting a push base", () => {
  assert.deepEqual(
    immediateEventDecision({ eventName: "push", ref: "refs/tags/app-v1.2.3", refType: "tag" }),
    { build: true, rust: true, reason: "release tag" },
  )
  assert.deepEqual(
    immediateEventDecision({
      eventName: "workflow_dispatch",
      ref: "refs/heads/main",
      refType: "branch",
    }),
    { build: true, rust: true, reason: "manual main build" },
  )
  assert.throws(
    () =>
      immediateEventDecision({
        eventName: "workflow_dispatch",
        ref: "refs/heads/dev",
        refType: "branch",
      }),
    /只允许从 main/,
  )
})
