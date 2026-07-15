import { sameFileRef, type FileRef } from "@protocol/file-system"
import type { NodeOfKind } from "@protocol/node"
import type { Subscription } from "@protocol/subscription"
import { readCompleteDirectory } from "@/filesystem/directory-walk"
import { corePlaceRef } from "@/filesystem/resource-file-system"
import { invokeFileAction, readFile } from "@/filesystem/registry"

export type FileSubscription = Subscription & {
  fileRef: FileRef
  version: string | null
}

export const SUBSCRIPTIONS_ROOT = corePlaceRef("subscriptions")

const DIRECTORY_CONTEXT = { actor: "ui", permissions: [], intent: "directory" } as const
const CONTENT_CONTEXT = { actor: "ui", permissions: [], intent: "content" } as const
const ACTION_CONTEXT = { actor: "ui", permissions: [], intent: "action" } as const

function subscriptionFromNode(
  node: NodeOfKind<"feed">,
  fileRef: FileRef,
  version: string | null,
): FileSubscription {
  const content = node.content
  return {
    id: `${content.type}:${content.key}`,
    type: content.type,
    key: content.key,
    title: node.title,
    favicon: content.favicon,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    ...(content.entityLabel === undefined ? {} : { entityLabel: content.entityLabel }),
    ...(content.entityName === undefined ? {} : { entityName: content.entityName }),
    ...(content.searchKeyword === undefined ? {} : { searchKeyword: content.searchKeyword }),
    ...(content.searchDomain === undefined ? {} : { searchDomain: content.searchDomain }),
    ...(node.deletedAt === undefined ? {} : { deletedAt: node.deletedAt }),
    fileRef,
    version,
  }
}

export async function readSubscriptions(): Promise<FileSubscription[]> {
  const entries = await readCompleteDirectory(SUBSCRIPTIONS_ROOT, DIRECTORY_CONTEXT)
  const subscriptions = await Promise.all(
    entries.map(async (entry): Promise<FileSubscription | null> => {
      const result = await readFile(entry.target, CONTENT_CONTEXT, { encoding: "json" })
      const node = result.data as NodeOfKind<"feed"> | null
      if (node?.kind !== "feed") return null
      const snapshotVersion =
        entry.file && sameFileRef(entry.file.ref, entry.target) ? entry.file.version : undefined
      return subscriptionFromNode(node, entry.target, result.version ?? snapshotVersion ?? null)
    }),
  )
  return subscriptions
    .filter((subscription): subscription is FileSubscription => subscription !== null)
    .sort((left, right) => right.createdAt - left.createdAt)
}

export function deleteSubscriptionFile(subscription: FileSubscription): Promise<unknown> {
  return invokeFileAction(subscription.fileRef, "delete", undefined, ACTION_CONTEXT, {
    expectedVersion: subscription.version,
  })
}

/** 撤销删除针对软删后的新快照，不复用删除前的版本。 */
export function restoreSubscriptionFile(subscription: FileSubscription): Promise<unknown> {
  return invokeFileAction(subscription.fileRef, "restore", undefined, ACTION_CONTEXT)
}
