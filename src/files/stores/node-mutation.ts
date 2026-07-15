import type { Node, NodeKind } from "@protocol/node"

/**
 * 单节点写入的 Storage CAS 基线。deletedAt 用 null 表示 live，避免将
 * “同版本但已转为 tombstone”误判为可写。
 */
export type NodeMutationExpectation = Readonly<{
  kind: NodeKind
  updatedAt: number
  deletedAt: number | null
}>

export class NodeMutationConflictError extends Error {
  constructor(readonly id?: string) {
    super(id ? `节点在写入前已变更: ${id}` : "节点在写入前已变更")
    this.name = "NodeMutationConflictError"
  }
}

export function nodeMutationExpectation(node: Node): NodeMutationExpectation {
  return {
    kind: node.kind,
    updatedAt: node.updatedAt,
    deletedAt: node.deletedAt ?? null,
  }
}

/** 必须在包含 nodes 的同一 readwrite 事务内对 fresh-read 值调用。 */
export function assertNodeMutationExpectation(
  current: Node | undefined,
  expected?: NodeMutationExpectation,
): void {
  if (!expected) return
  if (
    !current ||
    current.kind !== expected.kind ||
    current.updatedAt !== expected.updatedAt ||
    (current.deletedAt ?? null) !== expected.deletedAt
  ) {
    throw new NodeMutationConflictError(current?.id)
  }
}
