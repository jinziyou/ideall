import assert from "node:assert/strict"
import { test } from "node:test"
import {
  adoptWorkspaceTextDraftIfCurrent,
  createSerializedDraftCommitQueue,
  isWorkspaceTextDraftOperationCurrent,
  reconcileWorkspaceTextDraft,
  workspaceTextDraftOperationToken,
  type WorkspaceTextDraftState,
} from "./use-workspace-text-draft"

function deferred(): {
  promise: Promise<void>
  resolve(): void
  reject(error: unknown): void
} {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

test("workspace text draft: pending keystrokes coalesce and in-flight commits remain serialized", async () => {
  const firstEntered = deferred()
  const releaseFirst = deferred()
  const events: string[] = []
  const queue = createSerializedDraftCommitQueue<undefined>({
    debounceMs: 60_000,
    async commit(item) {
      events.push(`start:${item.value}`)
      if (item.value === "ab") {
        firstEntered.resolve()
        await releaseFirst.promise
      }
      events.push(`end:${item.value}`)
    },
  })

  queue.submit({ workspaceId: "ws-1", generation: 1, value: "a", context: undefined })
  queue.submit({ workspaceId: "ws-1", generation: 2, value: "ab", context: undefined })
  const first = queue.flush()
  await firstEntered.promise

  queue.submit({ workspaceId: "ws-1", generation: 3, value: "abc", context: undefined })
  const second = queue.flush()
  await Promise.resolve()
  assert.deepEqual(events, ["start:ab"], "the next generation must wait for the durable tail")

  releaseFirst.resolve()
  await Promise.all([first, second])
  assert.deepEqual(events, ["start:ab", "end:ab", "start:abc", "end:abc"])
  await queue.dispose(false)
})

test("workspace text draft: a failed durable generation does not poison the next edit", async () => {
  const errors: string[] = []
  const committed: string[] = []
  const queue = createSerializedDraftCommitQueue<undefined, string>({
    debounceMs: 60_000,
    async commit(item) {
      if (item.value === "rejected") throw new Error("storage unavailable")
      committed.push(item.value)
      return item.value
    },
    onError(_item, error) {
      errors.push(error instanceof Error ? error.message : String(error))
    },
  })

  queue.submit({ workspaceId: "ws-1", generation: 1, value: "rejected", context: undefined })
  await assert.rejects(queue.flush(), /storage unavailable/)
  queue.submit({ workspaceId: "ws-1", generation: 2, value: "accepted", context: undefined })
  await queue.flush()

  assert.deepEqual(errors, ["storage unavailable"])
  assert.deepEqual(committed, ["accepted"])
  await queue.dispose(false)
})

test("workspace text draft: a failed latest generation waits for an explicit flush before retry", async () => {
  const attempts: string[] = []
  let failOnce = true
  const queue = createSerializedDraftCommitQueue<undefined, string>({
    debounceMs: 60_000,
    async commit(item) {
      attempts.push(item.value)
      if (failOnce) {
        failOnce = false
        throw new Error("storage unavailable")
      }
      return item.value
    },
    onError() {
      return "keep"
    },
  })

  queue.submit({ workspaceId: "ws-1", generation: 1, value: "retained", context: undefined })
  await assert.rejects(queue.flush(), /storage unavailable/)
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(attempts, ["retained"], "a failure must not immediately spin a retry")

  await queue.flush()
  assert.deepEqual(attempts, ["retained", "retained"])
  await queue.dispose(false)
})

test("workspace text draft: concurrent flushes observe the same in-flight failure before retry", async () => {
  const entered = deferred()
  const release = deferred()
  let attempts = 0
  const queue = createSerializedDraftCommitQueue<undefined, string>({
    debounceMs: 60_000,
    async commit(item) {
      attempts += 1
      if (attempts === 1) {
        entered.resolve()
        await release.promise
      }
      return item.value
    },
  })

  queue.submit({ workspaceId: "ws-1", generation: 1, value: "retry me", context: undefined })
  const firstFlush = queue.flush()
  await entered.promise
  const concurrentFlush = queue.flush()
  const observedSettlements = Promise.allSettled([firstFlush, concurrentFlush])
  release.reject(new Error("storage unavailable"))

  const [first, concurrent] = await observedSettlements
  assert.equal(first.status, "rejected")
  assert.match(String(first.reason), /storage unavailable/)
  assert.equal(concurrent.status, "rejected")
  assert.match(String(concurrent.reason), /storage unavailable/)
  assert.equal(attempts, 1)

  await queue.flush()
  assert.equal(attempts, 2, "the retained failed item must remain explicitly retryable")
  await queue.dispose(false)
})

test("workspace text draft: a cleared failure does not leak into later idle flushes", async () => {
  let attempts = 0
  const queue = createSerializedDraftCommitQueue<undefined, string>({
    debounceMs: 60_000,
    async commit() {
      attempts += 1
      throw new Error("handled storage failure")
    },
    onError() {
      return "clear"
    },
  })

  queue.submit({ workspaceId: "ws-1", generation: 1, value: "clear me", context: undefined })
  await assert.rejects(queue.flush(), /handled storage failure/)
  await queue.flush()
  await queue.flush()

  assert.equal(attempts, 1, "an idle flush must neither replay nor rethrow a cleared failure")
  await queue.dispose(false)
})

test("workspace text draft: latest flush follows a queued newer generation past an older failure", async () => {
  const firstEntered = deferred()
  const releaseFirst = deferred()
  const attempts: string[] = []
  const queue = createSerializedDraftCommitQueue<undefined, string>({
    debounceMs: 60_000,
    async commit(item) {
      attempts.push(item.value)
      if (item.value === "old") {
        firstEntered.resolve()
        await releaseFirst.promise
      }
      return item.value
    },
  })

  queue.submit({ workspaceId: "ws-1", generation: 1, value: "old", context: undefined })
  const oldFlush = queue.flush()
  await firstEntered.promise
  queue.submit({ workspaceId: "ws-1", generation: 2, value: "new", context: undefined })
  const newFlush = queue.flush()
  const latestFlush = queue.flush()
  const oldSettlement = Promise.allSettled([oldFlush])
  releaseFirst.reject(new Error("old write failed"))

  const [old] = await oldSettlement
  assert.equal(old.status, "rejected")
  await Promise.all([newFlush, latestFlush])
  assert.deepEqual(attempts, ["old", "new"])
  await queue.dispose(false)
})

test("workspace text draft: a newer edit replaces a retained failed generation", async () => {
  const attempts: string[] = []
  const queue = createSerializedDraftCommitQueue<undefined, string>({
    debounceMs: 60_000,
    async commit(item) {
      attempts.push(item.value)
      if (item.value === "stale failed draft") throw new Error("storage unavailable")
      return item.value
    },
    onError() {
      return "keep"
    },
  })

  queue.submit({
    workspaceId: "ws-1",
    generation: 1,
    value: "stale failed draft",
    context: undefined,
  })
  await assert.rejects(queue.flush(), /storage unavailable/)
  queue.submit({
    workspaceId: "ws-1",
    generation: 2,
    value: "newer draft",
    context: undefined,
  })
  await queue.flush()
  await queue.flush()

  assert.deepEqual(attempts, ["stale failed draft", "newer draft"])
  await queue.dispose(false)
})

test("workspace text draft: cleanup retries a retained failure once before disposal", async () => {
  let attempts = 0
  const queue = createSerializedDraftCommitQueue<undefined, string>({
    debounceMs: 60_000,
    async commit(item) {
      attempts += 1
      if (attempts === 1) throw new Error("storage unavailable")
      return item.value
    },
  })

  queue.submit({ workspaceId: "ws-1", generation: 1, value: "retained", context: undefined })
  await assert.rejects(queue.flush(), /storage unavailable/)
  await queue.dispose()

  assert.equal(attempts, 2)
  queue.submit({ workspaceId: "ws-1", generation: 2, value: "ignored", context: undefined })
  await queue.flush()
  assert.equal(attempts, 2, "a disposed queue must remain inert")
})

test("workspace text draft: dirty generations resist stale sources until their exact ack arrives", () => {
  const dirty: WorkspaceTextDraftState = {
    workspaceId: "ws-1",
    value: "typed locally",
    generation: 3,
    acknowledgedGeneration: 2,
    dirty: true,
    observedSourceValue: "old durable",
    observedSourceVersion: "2",
    awaitingSourceValue: null,
    sourceAtAcknowledgement: null,
    sourceVersionAtAcknowledgement: null,
  }
  assert.equal(reconcileWorkspaceTextDraft(dirty, "ws-1", "old durable", "2"), dirty)

  const acknowledged: WorkspaceTextDraftState = {
    ...dirty,
    acknowledgedGeneration: 3,
    dirty: false,
    awaitingSourceValue: "typed locally",
    sourceAtAcknowledgement: "old durable",
    sourceVersionAtAcknowledgement: "2",
  }
  assert.equal(reconcileWorkspaceTextDraft(acknowledged, "ws-1", "old durable", "2"), acknowledged)
  assert.deepEqual(reconcileWorkspaceTextDraft(acknowledged, "ws-1", "typed locally", "3"), {
    ...acknowledged,
    observedSourceValue: "typed locally",
    observedSourceVersion: "3",
    awaitingSourceValue: null,
    sourceAtAcknowledgement: null,
    sourceVersionAtAcknowledgement: null,
  })
  assert.deepEqual(reconcileWorkspaceTextDraft(dirty, "ws-2", "other workspace", "8"), {
    workspaceId: "ws-2",
    value: "other workspace",
    generation: 0,
    acknowledgedGeneration: 0,
    dirty: false,
    observedSourceValue: "other workspace",
    observedSourceVersion: "8",
    awaitingSourceValue: null,
    sourceAtAcknowledgement: null,
    sourceVersionAtAcknowledgement: null,
  })
})

test("workspace text draft: canonical ack ignores the old render then converges to a newer remote value", () => {
  const acknowledged: WorkspaceTextDraftState = {
    workspaceId: "ws-1",
    value: "https://api.example.test/",
    generation: 7,
    acknowledgedGeneration: 7,
    dirty: false,
    observedSourceValue: "https://api.example.test",
    observedSourceVersion: "7",
    awaitingSourceValue: "https://api.example.test/",
    sourceAtAcknowledgement: "https://api.example.test",
    sourceVersionAtAcknowledgement: "7",
  }

  assert.equal(
    reconcileWorkspaceTextDraft(acknowledged, "ws-1", "https://api.example.test", "7"),
    acknowledged,
    "the pre-commit render must not roll back a canonical committed value",
  )
  assert.deepEqual(
    reconcileWorkspaceTextDraft(acknowledged, "ws-1", "https://api.example.test/", "8"),
    {
      ...acknowledged,
      observedSourceValue: "https://api.example.test/",
      observedSourceVersion: "8",
      awaitingSourceValue: null,
      sourceAtAcknowledgement: null,
      sourceVersionAtAcknowledgement: null,
    },
  )
  assert.deepEqual(reconcileWorkspaceTextDraft(acknowledged, "ws-1", "remote value", "9"), {
    ...acknowledged,
    value: "remote value",
    observedSourceValue: "remote value",
    observedSourceVersion: "9",
    awaitingSourceValue: null,
    sourceAtAcknowledgement: null,
    sourceVersionAtAcknowledgement: null,
  })
})

test("workspace text draft: a higher source revision wins even when its value returns to the pre-ack value", () => {
  const acknowledged: WorkspaceTextDraftState = {
    workspaceId: "ws-1",
    value: "local commit",
    generation: 11,
    acknowledgedGeneration: 11,
    dirty: false,
    observedSourceValue: "old durable",
    observedSourceVersion: "40",
    awaitingSourceValue: "local commit",
    sourceAtAcknowledgement: "old durable",
    sourceVersionAtAcknowledgement: "40",
  }

  assert.deepEqual(reconcileWorkspaceTextDraft(acknowledged, "ws-1", "old durable", "42"), {
    ...acknowledged,
    value: "old durable",
    observedSourceVersion: "42",
    awaitingSourceValue: null,
    sourceAtAcknowledgement: null,
    sourceVersionAtAcknowledgement: null,
  })
})

test("workspace text draft: operation tokens reject a newer edit or another workspace", () => {
  const current: WorkspaceTextDraftState = {
    workspaceId: "ws-1",
    value: "before generation",
    generation: 13,
    acknowledgedGeneration: 13,
    dirty: false,
    observedSourceValue: "before generation",
    observedSourceVersion: "50",
    awaitingSourceValue: null,
    sourceAtAcknowledgement: null,
    sourceVersionAtAcknowledgement: null,
  }
  const token = workspaceTextDraftOperationToken(current)

  assert.equal(isWorkspaceTextDraftOperationCurrent(current, token), true)
  assert.equal(isWorkspaceTextDraftOperationCurrent({ ...current, generation: 14 }, token), false)
  assert.equal(
    isWorkspaceTextDraftOperationCurrent({ ...current, workspaceId: "ws-2" }, token),
    false,
  )
  const newer = { ...current, generation: 14 }
  assert.equal(
    adoptWorkspaceTextDraftIfCurrent(newer, token, "generated"),
    newer,
    "a stale generation must not adopt generated text",
  )
  assert.deepEqual(adoptWorkspaceTextDraftIfCurrent(current, token, "generated"), {
    ...current,
    value: "generated",
    awaitingSourceValue: "generated",
    sourceAtAcknowledgement: "before generation",
    sourceVersionAtAcknowledgement: "50",
  })
})
