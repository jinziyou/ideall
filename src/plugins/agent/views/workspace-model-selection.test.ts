import assert from "node:assert/strict"
import { test } from "node:test"
import {
  acknowledgeWorkspaceModelSelection,
  beginWorkspaceModelSelection,
  createWorkspaceModelSelectionCoordinator,
  createWorkspaceModelSelectionDisplayState,
  reconcileWorkspaceModelSelectionDisplay,
  rejectWorkspaceModelSelection,
} from "./workspace-model-selection"

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("workspace model selection: pending drafts settle before the direct selection", async () => {
  const releaseDrafts = deferred()
  const events: string[] = []
  const coordinator = createWorkspaceModelSelectionCoordinator<string>({
    async flushDrafts() {
      events.push("flush:start")
      await releaseDrafts.promise
      events.push("flush:end")
    },
    async apply(selection) {
      events.push(`apply:${selection}`)
    },
  })

  const selected = coordinator.select("preset")
  await Promise.resolve()
  assert.deepEqual(events, ["flush:start"])

  releaseDrafts.resolve()
  assert.equal(await selected, true)
  assert.deepEqual(events, ["flush:start", "flush:end", "apply:preset"])
})

test("workspace model selection: two rapid selections persist only the last queued intent", async () => {
  const events: string[] = []
  const coordinator = createWorkspaceModelSelectionCoordinator<string>({
    async flushDrafts() {
      events.push("flush")
    },
    async apply(selection) {
      events.push(`apply:${selection}`)
    },
  })

  const first = coordinator.select("preset-a")
  const second = coordinator.select("global")

  assert.equal(await first, false)
  assert.equal(await second, true)
  assert.deepEqual(events, ["flush", "apply:global"])
})

test("workspace model selection: a failed intent reports its phase without poisoning the next", async () => {
  const failures: string[] = []
  let attempts = 0
  const coordinator = createWorkspaceModelSelectionCoordinator<string>({
    async flushDrafts() {},
    async apply(selection) {
      attempts += 1
      if (attempts === 1) throw new Error(`cannot apply ${selection}`)
    },
    onError(failure) {
      failures.push(`${failure.phase}:${failure.selection}`)
    },
  })

  await assert.rejects(coordinator.select("preset-a"), /cannot apply preset-a/)
  assert.equal(await coordinator.select("preset-b"), true)
  assert.deepEqual(failures, ["apply:preset-a"])
})

test("workspace model selection display: rapid preset then original value emits two current intents", () => {
  const initial = createWorkspaceModelSelectionDisplayState("ws-1", "original", "10")
  const preset = beginWorkspaceModelSelection(initial, "ws-1", "original", "10", "preset-a")
  assert.equal(preset.state.value, "preset-a", "the controlled Select must move optimistically")

  const original = beginWorkspaceModelSelection(preset.state, "ws-1", "original", "10", "original")
  assert.equal(original.state.value, "original")
  assert.equal(original.token.generation, preset.token.generation + 1)
  assert.equal(
    acknowledgeWorkspaceModelSelection(original.state, preset.token),
    original.state,
    "the old completion cannot acknowledge the newer original-value intent",
  )
  assert.deepEqual(acknowledgeWorkspaceModelSelection(original.state, original.token), {
    ...original.state,
    status: "settled",
  })
})

test("workspace model selection display: success waits for a matching source acknowledgement", () => {
  const initial = createWorkspaceModelSelectionDisplayState("ws-1", "original", "10")
  const intent = beginWorkspaceModelSelection(initial, "ws-1", "original", "10", "preset-a")
  const acknowledged = acknowledgeWorkspaceModelSelection(intent.state, intent.token)

  assert.equal(acknowledged.status, "awaiting-source")
  assert.equal(
    reconcileWorkspaceModelSelectionDisplay(acknowledged, "ws-1", "original", "10"),
    acknowledged,
  )
  assert.deepEqual(
    reconcileWorkspaceModelSelectionDisplay(acknowledged, "ws-1", "preset-a", "11"),
    {
      ...acknowledged,
      status: "settled",
      observedSourceValue: "preset-a",
      observedSourceVersion: "11",
      sourceAtAcknowledgement: null,
      sourceVersionAtAcknowledgement: null,
    },
  )
})

test("workspace model selection display: current failure rolls back but stale failure cannot", () => {
  const initial = createWorkspaceModelSelectionDisplayState("ws-1", "original", "10")
  const first = beginWorkspaceModelSelection(initial, "ws-1", "original", "10", "preset-a")
  assert.deepEqual(rejectWorkspaceModelSelection(first.state, first.token), {
    ...first.state,
    value: "original",
    status: "settled",
  })

  const second = beginWorkspaceModelSelection(first.state, "ws-1", "original", "10", "preset-b")
  assert.equal(rejectWorkspaceModelSelection(second.state, first.token), second.state)
})

test("workspace model selection display: workspace switches invalidate old callbacks including ABA", () => {
  const initial = createWorkspaceModelSelectionDisplayState("ws-a", "original", "10")
  const oldIntent = beginWorkspaceModelSelection(initial, "ws-a", "original", "10", "preset-a")
  const workspaceB = reconcileWorkspaceModelSelectionDisplay(
    oldIntent.state,
    "ws-b",
    "global",
    "20",
  )
  const workspaceAAgain = reconcileWorkspaceModelSelectionDisplay(
    workspaceB,
    "ws-a",
    "original",
    "30",
  )

  assert.equal(workspaceB.value, "global")
  assert.equal(workspaceAAgain.value, "original")
  assert.ok(workspaceAAgain.generation > oldIntent.token.generation)
  assert.equal(
    acknowledgeWorkspaceModelSelection(workspaceAAgain, oldIntent.token),
    workspaceAAgain,
  )
})
