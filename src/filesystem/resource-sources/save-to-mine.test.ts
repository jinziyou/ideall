import { test } from "node:test"
import assert from "node:assert/strict"
import type { Bookmark } from "@protocol/files"
import type { CaptureBookmarkInput } from "@protocol/capture"
import type { ResourceRef } from "@protocol/resource"
import type { NewSubscription, Subscription, SubscriptionType } from "@protocol/subscription"
import { projectSaveToMine, saveResourceToMine, type SaveToMineDeps } from "./save-to-mine"
import { ResourceSourceError, type ResourceSourceAccessContext } from "./types"

const uiCtx: ResourceSourceAccessContext = { actor: "ui", permissions: [] }

async function rejectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ResourceSourceError)
    assert.equal(error.code, code)
    return true
  })
}

function subscription(input: NewSubscription): Subscription {
  return {
    id: `${input.type}:${input.key}`,
    type: input.type,
    key: input.key,
    title: input.title,
    favicon: input.favicon ?? "",
    entityLabel: input.entityLabel,
    entityName: input.entityName,
    searchKeyword: input.searchKeyword,
    searchDomain: input.searchDomain,
    createdAt: 1,
    updatedAt: 1,
  }
}

function deps({
  subscriptions = [],
  bookmarks = [],
}: {
  subscriptions?: Subscription[]
  bookmarks?: Bookmark[]
} = {}): {
  deps: SaveToMineDeps
  addedBookmarks: CaptureBookmarkInput[]
  addedSubs: NewSubscription[]
} {
  const addedBookmarks: CaptureBookmarkInput[] = []
  const addedSubs: NewSubscription[] = []
  return {
    addedBookmarks,
    addedSubs,
    deps: {
      async isSubscribed(type: SubscriptionType, key: string) {
        return subscriptions.some((sub) => sub.type === type && sub.key === key)
      },
      async addSubscription(input: NewSubscription) {
        addedSubs.push(input)
        return (
          subscriptions.find((sub) => sub.type === input.type && sub.key === input.key) ??
          subscription(input)
        )
      },
      async captureBookmark(input) {
        const existing = bookmarks.find((bookmark) => bookmark.url === input.url)
        if (existing) return { status: "existing", bookmark: existing }
        addedBookmarks.push(input)
        return {
          status: "created",
          bookmark: {
            id: "bm-1",
            title: input.title,
            url: input.url,
            description: input.description ?? "",
            favicon: input.favicon ?? "",
            folderId: null,
            tags: ["收件箱"],
            createdAt: 1,
          },
        }
      },
    },
  }
}

test("save-to-mine projector: maps connected resources to mine assets", () => {
  assert.deepEqual(projectSaveToMine({ scheme: "info", kind: "entity", id: "ORG:示例" }), {
    kind: "subscription",
    input: {
      type: "entity",
      key: "ORG/示例",
      title: "示例",
      entityLabel: "ORG",
      entityName: "示例",
      favicon: undefined,
    },
  })

  assert.deepEqual(
    projectSaveToMine(
      { scheme: "browser", kind: "page", id: "https://example.com/post" },
      { title: "Post" },
    ),
    {
      kind: "bookmark",
      input: {
        title: "Post",
        url: "https://example.com/post",
        description: undefined,
        favicon: undefined,
      },
    },
  )
})

test("save-to-mine projector: writes bookmarks idempotently", async () => {
  const existing: Bookmark = {
    id: "bm-old",
    title: "Existing",
    url: "https://example.com",
    description: "",
    favicon: "",
    folderId: null,
    tags: [],
    createdAt: 1,
  }
  const state = deps({ bookmarks: [existing] })
  const ref: ResourceRef = { scheme: "browser", kind: "page", id: "https://example.com" }

  const result = await saveResourceToMine(ref, { title: "Example" }, uiCtx, state.deps)

  assert.equal(result.kind, "bookmark")
  if (result.kind === "bookmark") {
    assert.equal(result.existed, true)
    assert.equal(result.navigationPath, "/home/bookmarks")
  }
  assert.equal(state.addedBookmarks.length, 0)
})

test("save-to-mine projector: enforces write permission outside ui actor", async () => {
  const state = deps()
  const ref: ResourceRef = { scheme: "info", kind: "publisher", id: "example.com" }

  await rejectCode(
    saveResourceToMine(ref, null, { actor: "agent", permissions: [] }, state.deps),
    "permission-denied",
  )

  const result = await saveResourceToMine(
    ref,
    { title: "Example" },
    { actor: "agent", permissions: ["hub.subscriptions:write"] },
    state.deps,
  )

  assert.equal(result.kind, "subscription")
  if (result.kind === "subscription") {
    assert.equal(result.navigationPath, "/home/following")
  }
  assert.deepEqual(state.addedSubs[0], {
    type: "publisher",
    key: "example.com",
    title: "Example",
    favicon: undefined,
  })
})
