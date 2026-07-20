import type { Bookmark, NewBookmark } from "@protocol/files"
import type { ResourceRef } from "@protocol/resource"
import type { CaptureBookmarkInput, CaptureBookmarkResult } from "@protocol/capture"
import type { NewSubscription, Subscription, SubscriptionType } from "@protocol/subscription"
import { addSubscription, isSubscribed } from "@/files/stores/subscriptions-store"
import { captureBookmarkToMine } from "@/filesystem/capture-bookmark"
import { splitConnectedResourcePair } from "@/lib/connected-resource"
import type { ResourceSourceAccessContext } from "./types"
import { ResourceSourceError } from "./types"

export type SaveToMineProjection =
  { kind: "subscription"; input: NewSubscription } | { kind: "bookmark"; input: NewBookmark }

export type SaveToMineResult =
  | {
      kind: "subscription"
      subscription: Subscription
      existed: boolean
      navigationPath: "/home/following"
    }
  | {
      kind: "bookmark"
      bookmark: Bookmark
      existed: boolean
      navigationPath: "/home/bookmarks"
    }

export type SaveToMineDeps = {
  isSubscribed: (type: SubscriptionType, key: string) => Promise<boolean>
  addSubscription: (input: NewSubscription) => Promise<Subscription>
  captureBookmark: (
    input: CaptureBookmarkInput,
    ctx: ResourceSourceAccessContext,
  ) => Promise<CaptureBookmarkResult>
}

const defaultDeps: SaveToMineDeps = {
  isSubscribed,
  addSubscription,
  captureBookmark(input, ctx) {
    return captureBookmarkToMine(input, {
      actor: ctx.actor,
      permissions: ctx.permissions,
      intent: "action",
    })
  },
}

function objectInput(input: unknown): Record<string, unknown> {
  return input != null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function searchKey(keyword: string, domain: string | null): string {
  return domain ? `${domain}:${keyword}` : keyword
}

function subscriptionProjection(
  type: SubscriptionType,
  input: NewSubscription,
): SaveToMineProjection {
  return { kind: "subscription", input: { ...input, type } }
}

export function projectSaveToMine(
  ref: ResourceRef,
  input: unknown = null,
): SaveToMineProjection | null {
  const raw = objectInput(input)
  const title = nonEmpty(raw.title)

  if (ref.scheme === "info") {
    if (ref.kind === "publisher") {
      const domain = nonEmpty(raw.domain) ?? ref.id
      return subscriptionProjection("publisher", {
        type: "publisher",
        key: domain,
        title: title ?? domain,
        favicon: nonEmpty(raw.favicon) ?? undefined,
      })
    }
    if (ref.kind === "entity") {
      const pair = splitConnectedResourcePair(ref.id)
      if (!pair) return null
      const [label, name] = pair
      return subscriptionProjection("entity", {
        type: "entity",
        key: `${label}/${name}`,
        title: title ?? name,
        entityLabel: label,
        entityName: name,
        favicon: nonEmpty(raw.favicon) ?? undefined,
      })
    }
    if (ref.kind === "search") {
      const keyword = nonEmpty(raw.searchKeyword) ?? (ref.id === "default" ? null : ref.id)
      if (!keyword) return null
      const domain = nonEmpty(raw.searchDomain)
      return subscriptionProjection("search", {
        type: "search",
        key: searchKey(keyword, domain),
        title: title ?? keyword,
        searchKeyword: keyword,
        searchDomain: domain ?? undefined,
      })
    }
  }

  if (ref.scheme === "community" && ref.kind === "peer") {
    return subscriptionProjection("peer", {
      type: "peer",
      key: ref.id,
      title: title ?? ref.id,
      favicon: nonEmpty(raw.favicon) ?? undefined,
    })
  }

  if (ref.scheme === "browser" && ref.kind === "page") {
    const url = nonEmpty(raw.url) ?? (ref.id === "default" ? null : ref.id)
    if (!url) return null
    return {
      kind: "bookmark",
      input: {
        title: title ?? url,
        url,
        description: nonEmpty(raw.description) ?? undefined,
        favicon: nonEmpty(raw.favicon) ?? undefined,
      },
    }
  }

  if (ref.scheme === "tool") {
    const url = nonEmpty(raw.url) ?? (ref.id === "default" ? null : ref.id)
    if (!url) return null
    return subscriptionProjection("tool", {
      type: "tool",
      key: url,
      title: title ?? url,
      favicon: nonEmpty(raw.favicon) ?? undefined,
    })
  }

  return null
}

function canWriteProjection(
  ctx: ResourceSourceAccessContext,
  projection: SaveToMineProjection,
): boolean {
  if (ctx.actor === "ui") return true
  const required =
    projection.kind === "bookmark" ? "hub.bookmarks:write" : "hub.subscriptions:write"
  return ctx.permissions.includes(required)
}

export async function saveResourceToMine(
  ref: ResourceRef,
  input: unknown,
  ctx: ResourceSourceAccessContext,
  deps: SaveToMineDeps = defaultDeps,
): Promise<SaveToMineResult> {
  const projection = projectSaveToMine(ref, input)
  if (!projection) {
    throw new ResourceSourceError(
      "unsupported",
      `Resource cannot be saved to mine: ${ref.scheme}:${ref.kind}`,
    )
  }
  if (!canWriteProjection(ctx, projection)) {
    throw new ResourceSourceError(
      "permission-denied",
      "Missing permission to save resource to mine",
    )
  }

  if (projection.kind === "subscription") {
    const existed = await deps.isSubscribed(projection.input.type, projection.input.key)
    const subscription = await deps.addSubscription(projection.input)
    return { kind: "subscription", subscription, existed, navigationPath: "/home/following" }
  }

  const captured = await deps.captureBookmark(
    {
      title: projection.input.title,
      url: projection.input.url,
      description: projection.input.description,
      favicon: projection.input.favicon,
    },
    ctx,
  )
  return {
    kind: "bookmark",
    bookmark: captured.bookmark,
    existed: captured.status === "existing",
    navigationPath: "/home/bookmarks",
  }
}
