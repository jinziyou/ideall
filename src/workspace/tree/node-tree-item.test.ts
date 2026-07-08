import { test } from "node:test"
import assert from "node:assert/strict"
import type { ResourceMeta } from "@protocol/resource"
import { nodeTreeItemFromResourceMeta, nodeTreeItemsFromResourceMetas } from "./node-tree-item"

test("node tree item: maps node ResourceMeta into workspace tree item", () => {
  const meta: ResourceMeta = {
    ref: { scheme: "node", kind: "file", id: "f1" },
    title: "readme.md",
    parent: { scheme: "node", kind: "folder", id: "folder1" },
    sortKey: "a1",
    hasChildren: true,
    iconHint: "text/markdown",
    capabilities: ["open"],
  }

  assert.deepEqual(nodeTreeItemFromResourceMeta(meta), {
    id: "f1",
    kind: "file",
    title: "readme.md",
    parentId: "folder1",
    sortKey: "a1",
    hasChildren: true,
    mime: "text/markdown",
  })
})

test("node tree item: filters non-node resources", () => {
  const metas: ResourceMeta[] = [
    {
      ref: { scheme: "info", kind: "entity", id: "org:name" },
      title: "Org",
      capabilities: ["open"],
    },
    {
      ref: { scheme: "node", kind: "bookmark", id: "b1" },
      title: "Bookmark",
      capabilities: ["open"],
    },
  ]

  assert.deepEqual(nodeTreeItemsFromResourceMetas(metas), [
    {
      id: "b1",
      kind: "bookmark",
      title: "Bookmark",
      parentId: null,
      sortKey: "",
      hasChildren: false,
    },
  ])
})
