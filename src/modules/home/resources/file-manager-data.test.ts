import assert from "node:assert/strict"
import { test } from "node:test"
import type { DirectoryEntry, FileRef, IdeallFile } from "@protocol/file-system"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import { loadManagedFiles, type ManagedFilesGateway } from "./file-manager-data"

function ref(id: string): FileRef {
  return resourceFileRef({ scheme: "node", kind: "file", id })
}

function file(id: string, createdAt: number): IdeallFile {
  return {
    ref: ref(id),
    kind: "file",
    name: `${id}.txt`,
    mediaType: "text/plain",
    capabilities: ["read"],
    source: { kind: "local", id: "test" },
    createdAt,
    size: createdAt,
    properties: { tags: [id] },
  }
}

function entry(id: string, snapshot?: IdeallFile): DirectoryEntry {
  const target = ref(id)
  return {
    entryId: id,
    parent: { fileSystemId: "ideall.core", fileId: "place:files" },
    target,
    name: `${id}.txt`,
    kind: "link",
    ...(snapshot ? { file: snapshot } : {}),
  }
}

function gateway(
  entries: readonly DirectoryEntry[],
  stat: ManagedFilesGateway["stat"],
): ManagedFilesGateway {
  return {
    async readDirectory() {
      return { entries: [...entries] }
    },
    stat,
  }
}

test("file manager data: reads every page and reuses matching snapshots", async () => {
  const cursors: Array<string | undefined> = []
  let statCalls = 0
  const dataGateway: ManagedFilesGateway = {
    async readDirectory(_ref, _ctx, options) {
      cursors.push(options?.cursor)
      return options?.cursor === undefined
        ? { entries: [entry("first", file("first", 1))], nextCursor: "next" }
        : { entries: [entry("second", file("second", 2))] }
    },
    async stat() {
      statCalls += 1
      return null
    },
  }

  const files = await loadManagedFiles(dataGateway)
  assert.deepEqual(
    files.map((item) => item.id),
    ["second", "first"],
  )
  assert.deepEqual(cursors, [undefined, "next"])
  assert.equal(statCalls, 0)
})

test("file manager data: mismatched or missing snapshots fall back to target stat", async () => {
  const calls: string[] = []
  const mismatched = { ...file("other", 9), ref: ref("other") }
  const files = await loadManagedFiles(
    gateway(
      [entry("valid", file("valid", 3)), entry("mismatch", mismatched), entry("missing")],
      async (target) => {
        calls.push(target.fileId)
        const id = target.fileId.endsWith("mismatch") ? "mismatch" : "missing"
        return file(id, id === "mismatch" ? 2 : 1)
      },
    ),
  )

  assert.deepEqual(
    files.map((item) => item.id),
    ["valid", "mismatch", "missing"],
  )
  assert.deepEqual(calls, [ref("mismatch").fileId, ref("missing").fileId])
})

test("file manager data: stat fallback obeys the configured concurrency limit", async () => {
  let active = 0
  let maxActive = 0
  const entries = Array.from({ length: 12 }, (_, index) => entry(`file-${index}`))
  const files = await loadManagedFiles(
    gateway(entries, async (target) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      const id = decodeURIComponent(target.fileId.slice(target.fileId.lastIndexOf(":") + 1))
      return file(id, 1)
    }),
    { statConcurrency: 3 },
  )

  assert.equal(files.length, 12)
  assert.equal(maxActive, 3)
})
