import assert from "node:assert/strict"
import { test } from "node:test"
import { CAPTURE_ONBOARDING_STORAGE_KEY } from "./public-config"
import {
  claimFirstCapturePrompt,
  completeCaptureOnboarding,
  getCaptureOnboardingPhase,
  isPersistedCaptureOnboarding,
  recordFirstCreatedCapture,
  subscribeCaptureOnboarding,
} from "./capture-onboarding"

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(CAPTURE_ONBOARDING_STORAGE_KEY, initial)
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

test("capture onboarding: first created capture is prompted once and completion is durable", () => {
  const storage = memoryStorage()
  let notifications = 0
  const unsubscribe = subscribeCaptureOnboarding(() => {
    notifications += 1
  })
  try {
    assert.equal(getCaptureOnboardingPhase(storage), "not-started")
    assert.equal(recordFirstCreatedCapture(storage, 10), true)
    assert.equal(getCaptureOnboardingPhase(storage), "captured")
    assert.equal(recordFirstCreatedCapture(storage, 11), false, "later captures must not restart")

    assert.equal(claimFirstCapturePrompt(storage, 12), true)
    assert.equal(getCaptureOnboardingPhase(storage), "prompted")
    assert.equal(claimFirstCapturePrompt(storage, 13), false, "toast claim must be one-shot")

    assert.equal(completeCaptureOnboarding(storage, 14), true)
    assert.equal(getCaptureOnboardingPhase(storage), "completed")
    assert.equal(completeCaptureOnboarding(storage, 15), false)
    assert.equal(
      recordFirstCreatedCapture(storage, 16),
      false,
      "completed guide must stay completed",
    )
    assert.equal(notifications, 3)
  } finally {
    unsubscribe()
  }
})

test("capture onboarding: malformed or unavailable public config fails open", () => {
  const malformed = memoryStorage('{"version":1,"phase":"unknown"}')
  assert.equal(getCaptureOnboardingPhase(malformed), "not-started")
  assert.equal(completeCaptureOnboarding(malformed), false)
  assert.equal(isPersistedCaptureOnboarding({ version: 1, phase: "captured" }), false)

  const unavailable = {
    getItem: () => {
      throw new Error("unavailable")
    },
    setItem: () => {
      throw new Error("unavailable")
    },
    removeItem: () => {
      throw new Error("unavailable")
    },
  }
  assert.equal(recordFirstCreatedCapture(unavailable, 20), false)
  assert.equal(getCaptureOnboardingPhase(unavailable), "not-started")
})
