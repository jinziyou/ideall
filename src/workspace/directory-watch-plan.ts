import {
  fileRefKey,
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type { FileSystemWatchEvent } from "@/filesystem/types"

export type DirectoryWatchLoadedEntry = Readonly<{
  entry: Pick<DirectoryEntry, "entryId" | "parent" | "target">
  file: Pick<IdeallFile, "version"> | null
}>

export type DirectoryWatchOperation =
  | Readonly<{
      type: "stat"
      key: string
      entryId: string
      target: FileRef
      version?: string
    }>
  | Readonly<{
      type: "remove"
      key: string
      entryId: string
      target: FileRef
    }>

export type DirectoryWatchPlan =
  | Readonly<{ type: "ignore" }>
  | Readonly<{ type: "refresh"; reason: string }>
  | Readonly<{ type: "incremental"; operations: readonly DirectoryWatchOperation[] }>

const MAX_ENVELOPE_EVENTS = 10_000

export function directoryWatchEntryKey(entryId: string, target: FileRef): string {
  return JSON.stringify([entryId, fileRefKey(target)])
}

function flattenWatchEvent(event: FileSystemWatchEvent): FileSystemWatchEvent[] | null {
  const leaves: FileSystemWatchEvent[] = []
  const path = new Set<FileSystemWatchEvent>()
  const stack: Array<{ event: FileSystemWatchEvent; exit: boolean }> = [{ event, exit: false }]
  let visited = 0
  while (stack.length > 0) {
    const frame = stack.pop() as { event: FileSystemWatchEvent; exit: boolean }
    const current = frame.event
    if (frame.exit) {
      path.delete(current)
      continue
    }
    visited += 1
    if (visited > MAX_ENVELOPE_EVENTS || path.has(current)) return null
    if (!current.changes || current.changes.length === 0) {
      leaves.push(current)
      continue
    }
    path.add(current)
    stack.push({ event: current, exit: true })
    for (let index = current.changes.length - 1; index >= 0; index -= 1) {
      stack.push({ event: current.changes[index] as FileSystemWatchEvent, exit: false })
    }
  }
  return leaves
}

function refresh(reason: string): DirectoryWatchPlan {
  return { type: "refresh", reason }
}

/**
 * 将 watch 信封收敛成目录页可安全执行的最小操作。
 *
 * 只有父目录和已加载 link 身份均可证明的 changed/deleted 才增量处理；任何可能改变
 * 排序、分页窗口或 link 归属的事件都退回全量目录读取。
 */
export function planDirectoryWatchEvent(input: {
  directory: FileRef
  loaded: readonly DirectoryWatchLoadedEntry[]
  event: FileSystemWatchEvent
  paginationRisk: boolean
  knownVersions?: ReadonlyMap<string, string>
}): DirectoryWatchPlan {
  const leaves = flattenWatchEvent(input.event)
  if (!leaves) return refresh("malformed-envelope")

  const entries = new Map<string, DirectoryWatchLoadedEntry | null>()
  for (const loaded of input.loaded) {
    const previous = entries.get(loaded.entry.entryId)
    entries.set(loaded.entry.entryId, previous === undefined ? loaded : null)
  }

  const operations = new Map<string, DirectoryWatchOperation>()
  for (const event of leaves) {
    if (sameFileRef(event.ref, input.directory)) return refresh("directory-self-change")
    if (event.type === "created" || event.type === "mount-changed") {
      return refresh("directory-membership-change")
    }
    if (!event.entryId) return refresh("missing-entry-identity")

    const loaded = entries.get(event.entryId)
    if (!loaded) return refresh("entry-not-loaded-or-ambiguous")
    if (
      !sameFileRef(loaded.entry.parent, input.directory) ||
      !sameFileRef(loaded.entry.target, event.ref)
    ) {
      return refresh("entry-identity-mismatch")
    }

    const oldMatches = Boolean(event.oldParent && sameFileRef(event.oldParent, input.directory))
    const newMatches = Boolean(event.newParent && sameFileRef(event.newParent, input.directory))
    const key = directoryWatchEntryKey(event.entryId, event.ref)

    if (event.type === "deleted") {
      // A deleted event carrying a destination is a move/unlink projection, not a local-only delete.
      if (!oldMatches || event.newParent) return refresh("move-or-ambiguous-delete")
      const previous = operations.get(key)
      if (previous && previous.type !== "remove") return refresh("conflicting-entry-events")
      operations.set(key, {
        type: "remove",
        key,
        entryId: event.entryId,
        target: event.ref,
      })
      continue
    }

    // `changed` is safe only when the link is known to remain in this directory. A different
    // old/new parent pair is a move even though the target FileRef itself is unchanged.
    if (
      !newMatches ||
      (event.oldParent !== undefined && !oldMatches) ||
      (event.oldParent !== undefined && event.newParent !== undefined)
    ) {
      return refresh("move-or-ambiguous-change")
    }
    const knownVersion = input.knownVersions?.get(key) ?? loaded.file?.version
    if (event.version !== undefined && event.version === knownVersion) continue
    const previous = operations.get(key)
    if (previous && previous.type !== "stat") return refresh("conflicting-entry-events")
    operations.set(key, {
      type: "stat",
      key,
      entryId: event.entryId,
      target: event.ref,
      ...(event.version === undefined ? {} : { version: event.version }),
    })
  }

  if (operations.size === 0) return { type: "ignore" }
  if (input.paginationRisk) return refresh("pagination-risk")
  return { type: "incremental", operations: [...operations.values()] }
}

export type DirectoryWatchRequestToken = Readonly<{
  key: string
  epoch: number
  sequence: number
}>

/** Last-request-wins gate shared by the component and pure race tests. */
export class DirectoryWatchRequestGate {
  private active = true
  private epoch = 0
  private sequence = 0
  private readonly latest = new Map<string, number>()
  private readonly pending = new Map<string, string>()

  activate(): void {
    this.active = true
    this.reset()
  }

  reset(): void {
    this.epoch += 1
    this.latest.clear()
    this.pending.clear()
  }

  start(key: string, version?: string): DirectoryWatchRequestToken | null {
    if (!this.active) return null
    const sequence = ++this.sequence
    this.latest.set(key, sequence)
    // An unversioned request supersedes the prior versioned request too. Keeping the old marker
    // would make a later v2 event look applied even if that v2 request lost last-request-wins.
    if (version === undefined) this.pending.delete(key)
    else this.pending.set(key, version)
    return { key, epoch: this.epoch, sequence }
  }

  pendingVersions(): ReadonlyMap<string, string> {
    return this.pending
  }

  accepts(token: DirectoryWatchRequestToken): boolean {
    return (
      this.active && token.epoch === this.epoch && this.latest.get(token.key) === token.sequence
    )
  }

  invalidate(key: string): void {
    this.latest.delete(key)
    this.pending.delete(key)
  }

  dispose(): void {
    this.active = false
    this.reset()
  }
}
