import assert from "node:assert/strict"
import { test } from "node:test"
import { CAPTURE_BOOKMARK_ACTION } from "@protocol/capture"
import { getCaptureOnboardingPhase } from "@/lib/capture-onboarding"
import { corePlaceRef } from "./resource-file-system"
import {
  captureBookmarkToMine,
  decodeCaptureBookmarkResult,
  type CaptureBookmarkInvoker,
} from "./capture-bookmark"

const bookmark = {
  id: "bm-1",
  title: "Research",
  url: "https://example.com/research#finding",
  description: "A searchable finding",
  favicon: "https://example.com/favicon.ico",
  folderId: null,
  tags: ["收件箱"],
  createdAt: 1,
}

test("capture bookmark gateway: invokes the bookmarks specialized action", async () => {
  const calls: unknown[][] = []
  const invoke: CaptureBookmarkInvoker = async (...args) => {
    calls.push(args)
    return { status: "created", bookmark }
  }
  const input = {
    title: "Research",
    url: "https://example.com/research#finding",
    description: "A searchable finding",
  }
  const result = await captureBookmarkToMine(
    input,
    { actor: "embed", permissions: ["hub.bookmarks:write"], intent: "action" },
    invoke,
  )

  assert.deepEqual(result, { status: "created", bookmark })
  assert.deepEqual(calls, [
    [
      corePlaceRef("bookmarks"),
      CAPTURE_BOOKMARK_ACTION,
      input,
      { actor: "embed", permissions: ["hub.bookmarks:write"], intent: "action" },
    ],
  ])
})

test("capture bookmark gateway: rejects malformed provider receipts", () => {
  assert.throws(
    () =>
      decodeCaptureBookmarkResult({
        status: "created",
        bookmark: { ...bookmark, url: "javascript:alert(1)" },
      }),
    /无效的捕获回执/,
  )
  assert.throws(
    () => decodeCaptureBookmarkResult({ status: "unknown", bookmark }),
    /无效的捕获回执/,
  )
})

test("capture bookmark gateway: only a newly created bookmark starts onboarding", async () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  })
  try {
    await captureBookmarkToMine({ title: "Existing", url: bookmark.url }, undefined, async () => ({
      status: "existing",
      bookmark,
    }))
    assert.equal(getCaptureOnboardingPhase(storage), "not-started")

    await captureBookmarkToMine({ title: "Created", url: bookmark.url }, undefined, async () => ({
      status: "created",
      bookmark,
    }))
    assert.equal(getCaptureOnboardingPhase(storage), "captured")
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous)
    else Reflect.deleteProperty(globalThis, "localStorage")
  }
})
