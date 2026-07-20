import assert from "node:assert/strict"
import { test } from "node:test"
import {
  canStartTrashMutation,
  completeTrashRefresh,
  createTrashRefreshCoordinator,
  failTrashRefresh,
  runTrashRefreshRequest,
  settleTrashMutationWithRefresh,
  startTrashRefresh,
  visibleTrashRefreshView,
} from "./trash-refresh-coordinator"

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

test("trash refresh coordinator: only the latest request may commit", () => {
  const coordinator = createTrashRefreshCoordinator()
  const target = coordinator.activate("trash:root")
  const first = coordinator.begin(target)
  const second = coordinator.begin(target)

  assert.ok(first)
  assert.ok(second)
  assert.equal(coordinator.isCurrent(first), false)
  assert.equal(coordinator.isCurrent(second), true)
})

test("trash refresh coordinator: deactivation rejects late and newly triggered reads", () => {
  const coordinator = createTrashRefreshCoordinator()
  const target = coordinator.activate("trash:root")
  const request = coordinator.begin(target)
  assert.ok(request)

  coordinator.deactivate(target)

  assert.equal(coordinator.isTargetActive(target), false)
  assert.equal(coordinator.isCurrent(request), false)
  assert.equal(coordinator.begin(target), null)
})

test("trash refresh coordinator: root switches and stale cleanup cannot revive old work", () => {
  const coordinator = createTrashRefreshCoordinator()
  const firstRoot = coordinator.activate("trash:first")
  const firstRequest = coordinator.begin(firstRoot)
  assert.ok(firstRequest)

  const secondRoot = coordinator.activate("trash:second")
  const secondRequest = coordinator.begin(secondRoot)
  assert.ok(secondRequest)

  coordinator.deactivate(firstRoot)

  assert.equal(coordinator.isCurrent(firstRequest), false)
  assert.equal(coordinator.begin(firstRoot), null)
  assert.equal(coordinator.isTargetActive(secondRoot), true)
  assert.equal(coordinator.isCurrent(secondRequest), true)

  const returnedRoot = coordinator.activate("trash:first")
  const returnedRequest = coordinator.begin(returnedRoot)
  assert.ok(returnedRequest)
  assert.equal(coordinator.isCurrent(firstRequest), false)
  assert.equal(coordinator.isCurrent(returnedRequest), true)
})

test("trash refresh view: root switches hide old items and failures retain only same-root data", () => {
  const firstTarget = Object.freeze({ targetKey: "trash:first" })
  const secondTarget = Object.freeze({ targetKey: "trash:second" })
  const returnedFirstTarget = Object.freeze({ targetKey: "trash:first" })
  const first = completeTrashRefresh(firstTarget, ["first"])

  assert.deepEqual(visibleTrashRefreshView(first, secondTarget), {
    items: [],
    loading: true,
  })
  assert.deepEqual(startTrashRefresh(first, secondTarget), {
    target: secondTarget,
    items: [],
    loading: true,
  })
  assert.deepEqual(failTrashRefresh(first, firstTarget), {
    target: firstTarget,
    items: ["first"],
    loading: false,
  })
  assert.deepEqual(failTrashRefresh(first, secondTarget), {
    target: secondTarget,
    items: [],
    loading: false,
  })
  assert.deepEqual(visibleTrashRefreshView(first, returnedFirstTarget), {
    items: [],
    loading: true,
  })
})

test("trash refresh runner: a newer success suppresses an older failure", async () => {
  const coordinator = createTrashRefreshCoordinator()
  const target = coordinator.activate("trash:root")
  const first = deferred<string>()
  const second = deferred<string>()
  const events: string[] = []
  const callbacks = {
    onStart() {
      events.push("start")
    },
    onSuccess(value: string) {
      events.push(`success:${value}`)
    },
    onError(error: unknown) {
      events.push(`error:${String(error)}`)
    },
  }

  const firstRun = runTrashRefreshRequest(coordinator, target, () => first.promise, callbacks)
  const secondRun = runTrashRefreshRequest(coordinator, target, () => second.promise, callbacks)
  second.resolve("second")
  assert.equal(await secondRun, "success")
  first.reject(new Error("late first"))

  assert.equal(await firstRun, "stale")
  assert.deepEqual(events, ["start", "start", "success:second"])
})

test("trash refresh runner: a newer success suppresses an older success", async () => {
  const coordinator = createTrashRefreshCoordinator()
  const target = coordinator.activate("trash:root")
  const first = deferred<string>()
  const second = deferred<string>()
  const successes: string[] = []
  const callbacks = {
    onStart() {},
    onSuccess(value: string) {
      successes.push(value)
    },
    onError() {},
  }

  const firstRun = runTrashRefreshRequest(coordinator, target, () => first.promise, callbacks)
  const secondRun = runTrashRefreshRequest(coordinator, target, () => second.promise, callbacks)
  second.resolve("second")
  assert.equal(await secondRun, "success")
  first.resolve("first")

  assert.equal(await firstRun, "stale")
  assert.deepEqual(successes, ["second"])
})

test("trash refresh runner: stale completion cannot clear the latest loading state", async () => {
  const coordinator = createTrashRefreshCoordinator()
  const target = coordinator.activate("trash:root")
  const first = deferred<string>()
  const second = deferred<string>()
  let loading = false
  const callbacks = {
    onStart() {
      loading = true
    },
    onSuccess() {
      loading = false
    },
    onError() {
      loading = false
    },
  }

  const firstRun = runTrashRefreshRequest(coordinator, target, () => first.promise, callbacks)
  const secondRun = runTrashRefreshRequest(coordinator, target, () => second.promise, callbacks)
  first.resolve("first")

  assert.equal(await firstRun, "stale")
  assert.equal(loading, true)

  second.resolve("second")
  assert.equal(await secondRun, "success")
  assert.equal(loading, false)
})

test("trash refresh runner: deactivation suppresses unmount-time commits and errors", async () => {
  const coordinator = createTrashRefreshCoordinator()
  const target = coordinator.activate("trash:root")
  const reading = deferred<string>()
  const events: string[] = []
  const run = runTrashRefreshRequest(coordinator, target, () => reading.promise, {
    onStart() {
      events.push("start")
    },
    onSuccess() {
      events.push("success")
    },
    onError() {
      events.push("error")
    },
  })

  coordinator.deactivate(target)
  reading.reject(new Error("late unmount failure"))

  assert.equal(await run, "stale")
  assert.deepEqual(events, ["start"])
  assert.equal(
    await runTrashRefreshRequest(coordinator, target, async () => "unreachable", {
      onStart() {
        events.push("unexpected")
      },
      onSuccess() {
        events.push("unexpected")
      },
      onError() {
        events.push("unexpected")
      },
    }),
    "skipped",
  )
  assert.deepEqual(events, ["start"])
})

test("trash refresh runner: the current failure reports once and settles loading", async () => {
  const coordinator = createTrashRefreshCoordinator()
  const target = coordinator.activate("trash:root")
  const reading = deferred<string>()
  let loading = false
  const errors: unknown[] = []
  const run = runTrashRefreshRequest(coordinator, target, () => reading.promise, {
    onStart() {
      loading = true
    },
    onSuccess() {
      loading = false
    },
    onError(error) {
      errors.push(error)
      loading = false
    },
  })
  const failure = new Error("current failure")
  reading.reject(failure)

  assert.equal(await run, "error")
  assert.equal(loading, false)
  assert.deepEqual(errors, [failure])
})

test("trash mutation settlement: starts refresh before releasing busy without awaiting I/O", async () => {
  const refreshing = deferred<void>()
  const events: string[] = []
  let settled = false

  const settlement = settleTrashMutationWithRefresh(
    () => {
      events.push("refresh")
      return refreshing.promise
    },
    () => events.push("release"),
  ).then(() => {
    settled = true
  })

  assert.deepEqual(events, ["refresh", "release"])
  assert.equal(settled, false)

  refreshing.resolve()
  await settlement
  assert.equal(settled, true)
})

test("trash mutation settlement: releases busy even if refresh startup throws", () => {
  let released = false
  const failure = new Error("refresh startup failed")

  assert.throws(
    () =>
      settleTrashMutationWithRefresh(
        () => {
          throw failure
        },
        () => {
          released = true
        },
      ),
    failure,
  )
  assert.equal(released, true)
})

test("trash mutation guard: loading blocks direct restore but not confirmed destructive actions", () => {
  const loading = { loading: true, mutationBusy: false }

  assert.equal(canStartTrashMutation("restore", loading), false)
  assert.equal(canStartTrashMutation("purge", loading), true)
  assert.equal(canStartTrashMutation("empty", loading), true)
  assert.equal(canStartTrashMutation("empty", { loading: false, mutationBusy: true }), false)
})
