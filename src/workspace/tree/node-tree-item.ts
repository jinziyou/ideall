import type { ResourceMeta } from "@protocol/resource"
import type { NodeKind } from "@protocol/node"

export type NodeTreeItem = {
  id: string
  kind: NodeKind
  title: string
  parentId: string | null
  sortKey: string
  hasChildren: boolean
  mime?: string
}

export function nodeTreeItemFromResourceMeta(meta: ResourceMeta): NodeTreeItem | null {
  if (meta.ref.scheme !== "node") return null
  return {
    id: meta.ref.id,
    kind: meta.ref.kind,
    title: meta.title,
    parentId: meta.parent?.scheme === "node" ? meta.parent.id : null,
    sortKey: meta.sortKey ?? "",
    hasChildren: meta.hasChildren ?? false,
    ...(meta.ref.kind === "file" ? { mime: meta.iconHint ?? "" } : {}),
  }
}

export function nodeTreeItemsFromResourceMetas(metas: ResourceMeta[]): NodeTreeItem[] {
  return metas.flatMap((meta) => {
    const item = nodeTreeItemFromResourceMeta(meta)
    return item ? [item] : []
  })
}
