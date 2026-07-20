import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import {
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type { NodeOfKind } from "@protocol/node"
import { corePlaceRef, resourceFileRef } from "@/filesystem/resource-file-system"
import { clearFileSystemsForTest, registerFileSystem } from "@/filesystem/registry"
import type { FileActionInvokeOptions, FileSystemProvider } from "@/filesystem/types"
import {
  createNoteFile,
  deleteNoteFile,
  listNoteFiles,
  moveNoteFile,
  restoreNoteFile,
  updateNoteFileTags,
} from "./note-file-system"

type Invocation = {
  action: string
  input: unknown
  options: FileActionInvokeOptions | undefined
}

const NOTES_ROOT = corePlaceRef("notes")
const parentRef = resourceFileRef({ scheme: "node", kind: "note", id: "parent" })
const childRef = resourceFileRef({ scheme: "node", kind: "note", id: "child" })
const createdRef = resourceFileRef({ scheme: "node", kind: "note", id: "created" })

function metadata(ref: FileRef, version?: string): IdeallFile {
  return {
    ref,
    kind: "directory",
    name: ref.fileId,
    mediaType: "inode/directory",
    capabilities: ["read-directory", "read", "actions"],
    source: { kind: "local", id: ref.fileSystemId },
    ...(version === undefined ? {} : { version }),
  }
}

function noteNode(id: string): NodeOfKind<"note"> {
  return {
    id,
    kind: "note",
    parentId: id === "child" ? "parent" : null,
    sortKey: id,
    title: id,
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    content: [{ type: "p", children: [{ text: `${id} text` }] }],
  }
}

function entry(
  parent: FileRef,
  target: FileRef,
  hasChildren: boolean,
  version?: string,
): DirectoryEntry {
  return {
    entryId: target.fileId,
    parent,
    target,
    name: target.fileId,
    kind: "child",
    file: metadata(target, version),
    sortKey: target.fileId,
    properties: {
      parentId: sameFileRef(parent, NOTES_ROOT) ? null : "parent",
      tags: [],
      createdAt: 1,
      updatedAt: 2,
      hasChildren,
    },
  }
}

function fixture() {
  clearFileSystemsForTest()
  const invocations: Invocation[] = []
  const provider: FileSystemProvider = {
    descriptor: {
      fileSystemId: NOTES_ROOT.fileSystemId,
      name: "notes fixture",
      root: { fileSystemId: NOTES_ROOT.fileSystemId, fileId: "fixture-root" },
      source: { kind: "local", id: "notes-fixture" },
    },
    async stat(ref) {
      if (sameFileRef(ref, parentRef)) return metadata(ref, "parent-meta-v")
      if (sameFileRef(ref, childRef)) return metadata(ref)
      if (sameFileRef(ref, createdRef)) return metadata(ref, "created-v")
      return null
    },
    async readDirectory(ref) {
      if (sameFileRef(ref, NOTES_ROOT)) {
        return { entries: [entry(NOTES_ROOT, parentRef, true, "parent-meta-v")] }
      }
      if (sameFileRef(ref, parentRef)) {
        return { entries: [entry(parentRef, childRef, false)] }
      }
      throw new Error(`unexpected directory: ${ref.fileId}`)
    },
    async read(ref) {
      if (sameFileRef(ref, parentRef)) {
        return { data: noteNode("parent"), mediaType: "application/json", version: "parent-read-v" }
      }
      if (sameFileRef(ref, childRef)) {
        return { data: noteNode("child"), mediaType: "application/json" }
      }
      throw new Error(`unexpected read: ${ref.fileId}`)
    },
    async write() {
      throw new Error("unexpected write")
    },
    async actions() {
      return []
    },
    async invoke(_ref, action, input, _ctx, options) {
      invocations.push({ action, input, options })
      if (action === "create") return { file: metadata(createdRef, "created-v") }
      return null
    },
  }
  registerFileSystem(provider)
  return { invocations }
}

afterEach(clearFileSystemsForTest)

test("note adapter: IdeallFile/ReadResult versions reach move/delete and undo remains unconditional", async () => {
  const { invocations } = fixture()
  const metadataOnly = await listNoteFiles()
  assert.deepEqual(
    metadataOnly.map(({ id, version }) => ({ id, version })),
    [
      { id: "parent", version: "parent-meta-v" },
      { id: "child", version: null },
    ],
  )

  const withText = await listNoteFiles(true)
  assert.deepEqual(
    withText.map(({ id, version }) => ({ id, version })),
    [
      { id: "parent", version: "parent-read-v" },
      { id: "child", version: null },
    ],
  )

  await moveNoteFile(metadataOnly[0]!, null, "after")
  await deleteNoteFile(metadataOnly[1]!)
  await createNoteFile(null)
  await createNoteFile("parent", {
    title: "Captured page",
    tags: ["网页快照", "离线"],
    content: [{ type: "p", children: [{ text: "offline text" }] }],
  })
  await updateNoteFileTags(metadataOnly[0]!, ["归档"])
  await restoreNoteFile("parent")

  assert.deepEqual(invocations, [
    {
      action: "move",
      input: { parentId: null, afterSortKey: "after" },
      options: { expectedVersion: "parent-meta-v" },
    },
    { action: "delete", input: undefined, options: { expectedVersion: null } },
    { action: "create", input: {}, options: undefined },
    {
      action: "create",
      input: {
        title: "Captured page",
        tags: ["网页快照", "离线"],
        content: [{ type: "p", children: [{ text: "offline text" }] }],
      },
      options: undefined,
    },
    {
      action: "edit",
      input: { tags: ["归档"] },
      options: { expectedVersion: "parent-meta-v" },
    },
    { action: "restore", input: undefined, options: undefined },
  ])
})
