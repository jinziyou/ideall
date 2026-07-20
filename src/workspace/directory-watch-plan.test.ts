import assert from "node:assert/strict"
import { test } from "node:test"
import type { DirectoryEntry, FileRef, IdeallFile } from "@protocol/file-system"
import type { FileSystemWatchEvent } from "@/filesystem/types"
import {
  DirectoryWatchRequestGate,
  directoryWatchEntryKey,
  planDirectoryWatchEvent,
  type DirectoryWatchLoadedEntry,
} from "./directory-watch-plan"

const directory: FileRef = { fileSystemId: "watch-plan", fileId: "directory" }

function loaded(entryId: string, fileId: string, version?: string): DirectoryWatchLoadedEntry {
  const target: FileRef = { fileSystemId: directory.fileSystemId, fileId }
  return {
    entry: { entryId, parent: directory, target } satisfies Pick<
      DirectoryEntry,
      "entryId" | "parent" | "target"
    >,
    file: version === undefined ? null : ({ version } satisfies Pick<IdeallFile, "version">),
  }
}

test("directory watch plan unwraps changes and emits stat/remove operations for loaded links", () => {
  const first = loaded("first-entry", "first", "1")
  const second = loaded("second-entry", "second", "1")
  const event: FileSystemWatchEvent = {
    type: "changed",
    ref: directory,
    changes: [
      {
        type: "changed",
        ref: first.entry.target,
        entryId: first.entry.entryId,
        newParent: directory,
        version: "2",
      },
      {
        type: "deleted",
        ref: second.entry.target,
        entryId: second.entry.entryId,
        oldParent: directory,
      },
    ],
  }

  assert.deepEqual(
    planDirectoryWatchEvent({
      directory,
      loaded: [first, second],
      event,
      paginationRisk: false,
    }),
    {
      type: "incremental",
      operations: [
        {
          type: "stat",
          key: directoryWatchEntryKey("first-entry", first.entry.target),
          entryId: "first-entry",
          target: first.entry.target,
          version: "2",
        },
        {
          type: "remove",
          key: directoryWatchEntryKey("second-entry", second.entry.target),
          entryId: "second-entry",
          target: second.entry.target,
        },
      ],
    },
  )
})

test("directory watch plan ignores an already applied provider version", () => {
  const item = loaded("entry", "file", "2")
  const key = directoryWatchEntryKey(item.entry.entryId, item.entry.target)
  assert.deepEqual(
    planDirectoryWatchEvent({
      directory,
      loaded: [item],
      event: {
        type: "changed",
        ref: item.entry.target,
        entryId: item.entry.entryId,
        newParent: directory,
        version: "pending",
      },
      paginationRisk: true,
      knownVersions: new Map([[key, "pending"]]),
    }),
    { type: "ignore" },
  )
})

test("directory watch plan treats a direct database-style row update as one stat", () => {
  const row = loaded("row-1", "row:table:row-1", "1")
  assert.deepEqual(
    planDirectoryWatchEvent({
      directory,
      loaded: [row],
      event: {
        type: "changed",
        ref: row.entry.target,
        entryId: row.entry.entryId,
        newParent: directory,
        version: "2",
      },
      paginationRisk: false,
    }),
    {
      type: "incremental",
      operations: [
        {
          type: "stat",
          key: directoryWatchEntryKey(row.entry.entryId, row.entry.target),
          entryId: row.entry.entryId,
          target: row.entry.target,
          version: "2",
        },
      ],
    },
  )
})

test("directory watch plan falls back for membership, identity, move, and pagination risks", () => {
  const item = loaded("entry", "file", "1")
  const otherParent: FileRef = { fileSystemId: directory.fileSystemId, fileId: "other" }
  const events: FileSystemWatchEvent[] = [
    { type: "created", ref: item.entry.target, entryId: "new", newParent: directory },
    { type: "changed", ref: directory },
    { type: "changed", ref: item.entry.target, newParent: directory },
    {
      type: "changed",
      ref: item.entry.target,
      entryId: item.entry.entryId,
      oldParent: directory,
      newParent: directory,
    },
    {
      type: "changed",
      ref: item.entry.target,
      entryId: item.entry.entryId,
      oldParent: otherParent,
      newParent: directory,
    },
    {
      type: "deleted",
      ref: item.entry.target,
      entryId: item.entry.entryId,
      oldParent: directory,
      newParent: otherParent,
    },
  ]

  for (const event of events) {
    assert.equal(
      planDirectoryWatchEvent({
        directory,
        loaded: [item],
        event,
        paginationRisk: false,
      }).type,
      "refresh",
    )
  }
  assert.equal(
    planDirectoryWatchEvent({
      directory,
      loaded: [item],
      event: {
        type: "changed",
        ref: item.entry.target,
        entryId: item.entry.entryId,
        newParent: directory,
        version: "2",
      },
      paginationRisk: true,
    }).type,
    "refresh",
  )
})

test("directory watch plan rejects cyclic envelopes and conflicting operations", () => {
  const item = loaded("entry", "file")
  const cyclic: FileSystemWatchEvent = { type: "changed", ref: directory, changes: [] }
  ;(cyclic as unknown as { changes: FileSystemWatchEvent[] }).changes = [cyclic]
  assert.equal(
    planDirectoryWatchEvent({
      directory,
      loaded: [item],
      event: cyclic,
      paginationRisk: false,
    }).type,
    "refresh",
  )

  assert.equal(
    planDirectoryWatchEvent({
      directory,
      loaded: [item],
      event: {
        type: "changed",
        ref: directory,
        changes: [
          {
            type: "changed",
            ref: item.entry.target,
            entryId: item.entry.entryId,
            newParent: directory,
          },
          {
            type: "deleted",
            ref: item.entry.target,
            entryId: item.entry.entryId,
            oldParent: directory,
          },
        ],
      },
      paginationRisk: false,
    }).type,
    "refresh",
  )
})

test("directory watch request gate rejects superseded, prior-epoch, and post-dispose results", () => {
  const gate = new DirectoryWatchRequestGate()
  const first = gate.start("entry")
  const other = gate.start("other")
  const second = gate.start("entry")
  assert.ok(first && other && second)
  assert.equal(gate.accepts(first), false)
  assert.equal(gate.accepts(other), true)
  assert.equal(gate.accepts(second), true)

  const versioned = gate.start("versioned", "v2")
  assert.ok(versioned)
  assert.equal(gate.pendingVersions().get("versioned"), "v2")
  const unversioned = gate.start("versioned")
  assert.ok(unversioned)
  assert.equal(gate.accepts(versioned), false)
  assert.equal(gate.accepts(unversioned), true)
  assert.equal(
    gate.pendingVersions().has("versioned"),
    false,
    "a newer unversioned stat must clear the superseded pending version",
  )

  gate.reset()
  assert.equal(gate.accepts(other), false)
  assert.equal(gate.accepts(second), false)
  const nextEpoch = gate.start("entry")
  assert.ok(nextEpoch)
  gate.dispose()
  assert.equal(gate.accepts(nextEpoch), false)
  assert.equal(gate.start("entry"), null)

  gate.activate()
  const reactivated = gate.start("entry")
  assert.ok(reactivated)
  assert.equal(gate.accepts(reactivated), true)
})
