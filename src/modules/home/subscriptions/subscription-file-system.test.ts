import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import {
  DIRECTORY_MEDIA_TYPE,
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type { NodeOfKind } from "@protocol/node"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import { clearFileSystemsForTest, registerFileSystem } from "@/filesystem/registry"
import type { FileActionInvokeOptions, FileSystemProvider } from "@/filesystem/types"
import {
  SUBSCRIPTIONS_ROOT,
  deleteSubscriptionFile,
  readSubscriptions,
  restoreSubscriptionFile,
} from "./subscription-file-system"

type Invocation = {
  action: string
  options: FileActionInvokeOptions | undefined
}

function feedNode(id: string, createdAt: number): NodeOfKind<"feed"> {
  return {
    id,
    kind: "feed",
    parentId: null,
    sortKey: id,
    title: id,
    tags: [],
    createdAt,
    updatedAt: createdAt,
    content: { type: "publisher", key: `${id}.example`, favicon: "" },
  }
}

function file(ref: FileRef, version?: string): IdeallFile {
  return {
    ref,
    kind: "file",
    name: ref.fileId,
    mediaType: "application/json",
    capabilities: ["read", "actions"],
    source: { kind: "local", id: ref.fileSystemId },
    ...(version === undefined ? {} : { version }),
  }
}

function fixture() {
  clearFileSystemsForTest()
  const ids = ["read-version", "file-version", "unversioned"]
  const refs = ids.map((id) => resourceFileRef({ scheme: "node", kind: "feed", id }))
  const nodes = new Map(refs.map((ref, index) => [ref.fileId, feedNode(ids[index]!, index + 1)]))
  const readVersions = new Map<string, string | undefined>([
    [refs[0]!.fileId, "read-v1"],
    [refs[1]!.fileId, undefined],
    [refs[2]!.fileId, undefined],
  ])
  const entries: DirectoryEntry[] = refs.map((ref, index) => ({
    entryId: ref.fileId,
    parent: SUBSCRIPTIONS_ROOT,
    target: ref,
    name: ref.fileId,
    kind: "child",
    file: file(ref, index === 1 ? "file-v2" : undefined),
  }))
  const invocations: Invocation[] = []
  const provider: FileSystemProvider = {
    descriptor: {
      fileSystemId: SUBSCRIPTIONS_ROOT.fileSystemId,
      name: "subscriptions fixture",
      root: { fileSystemId: SUBSCRIPTIONS_ROOT.fileSystemId, fileId: "fixture-root" },
      source: { kind: "local", id: "subscriptions-fixture" },
    },
    async stat(ref) {
      return refs.find((candidate) => sameFileRef(candidate, ref)) ? file(ref) : null
    },
    async readDirectory(ref) {
      assert.ok(sameFileRef(ref, SUBSCRIPTIONS_ROOT))
      return { entries }
    },
    async read(ref) {
      const data = nodes.get(ref.fileId)
      assert.ok(data)
      const version = readVersions.get(ref.fileId)
      return {
        data,
        mediaType: "application/json",
        ...(version === undefined ? {} : { version }),
      }
    },
    async write() {
      throw new Error("unexpected write")
    },
    async actions() {
      return []
    },
    async invoke(_ref, action, _input, _ctx, options) {
      invocations.push({ action, options })
      return null
    },
  }
  registerFileSystem(provider)
  return { invocations }
}

afterEach(clearFileSystemsForTest)

test("subscription adapter: read snapshots carry versions into delete while restore stays unconditional", async () => {
  const { invocations } = fixture()
  const subscriptions = await readSubscriptions()

  assert.deepEqual(
    subscriptions.map(({ title, version }) => ({ title, version })),
    [
      { title: "unversioned", version: null },
      { title: "file-version", version: "file-v2" },
      { title: "read-version", version: "read-v1" },
    ],
  )

  await deleteSubscriptionFile(subscriptions[2]!)
  await deleteSubscriptionFile(subscriptions[0]!)
  await restoreSubscriptionFile(subscriptions[2]!)

  assert.deepEqual(invocations, [
    { action: "delete", options: { expectedVersion: "read-v1" } },
    { action: "delete", options: { expectedVersion: null } },
    { action: "restore", options: undefined },
  ])
})
