import type { NodeKind } from "@protocol/node"
import type { NodeResourceRef } from "@protocol/resource"

export type NodeMoveActionInput = {
  parentId: string | null
  afterSortKey?: string | null
}

export function nodeResourceRef(kind: NodeKind, id: string): NodeResourceRef {
  return { scheme: "node", kind, id }
}

export function nodeMoveActionInput(
  parentId: string | null,
  afterSortKey?: string | null,
): NodeMoveActionInput {
  return {
    parentId,
    ...(afterSortKey === undefined ? {} : { afterSortKey }),
  }
}
