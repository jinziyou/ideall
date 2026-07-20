import { fileRefKey, type FileRef } from "@protocol/file-system"
import { watchFile } from "./registry"
import type { FileSystemAccessContext, FileSystemWatchEvent, FileSystemWatchHandle } from "./types"

type WatchSubscription = {
  readonly ref: FileRef
  readonly notify: (event: FileSystemWatchEvent) => void
  active: boolean
}

function safeDispose(handle: FileSystemWatchHandle): void {
  try {
    handle.dispose()
  } catch {
    // 清理是 best-effort；一个来源故障不能泄漏其余来源。
  }
}

function mergeEvent(
  previous: FileSystemWatchEvent,
  next: FileSystemWatchEvent,
): FileSystemWatchEvent {
  const type =
    previous.type === "created" && next.type === "changed"
      ? "created"
      : previous.type === "deleted" && next.type === "created"
        ? "changed"
        : next.type
  return {
    type,
    ref: next.ref,
    entryId: next.entryId ?? previous.entryId,
    oldParent: previous.oldParent ?? next.oldParent,
    // A terminal delete has no post-change parent/version; retaining an earlier create/change
    // value would make the coalesced event claim that the removed link still exists.
    newParent: next.type === "deleted" ? undefined : (next.newParent ?? previous.newParent),
    version: next.type === "deleted" ? next.version : (next.version ?? previous.version),
  }
}

function uniqueRefKeys(refs: readonly (FileRef | undefined)[]): string[] {
  const definedRefs = refs.filter((ref): ref is FileRef => ref !== undefined)
  return [...new Set(definedRefs.map(fileRefKey))]
}

function routedRefKeys(event: FileSystemWatchEvent): string[] {
  return uniqueRefKeys([event.ref, event.oldParent, event.newParent])
}

function atomicEvents(event: FileSystemWatchEvent): FileSystemWatchEvent[] {
  const result: FileSystemWatchEvent[] = []
  const pending = [event]
  const seen = new Set<FileSystemWatchEvent>()
  while (pending.length > 0) {
    const current = pending.pop() as FileSystemWatchEvent
    if (seen.has(current)) continue
    seen.add(current)
    if (current.changes && current.changes.length > 0) {
      // `changes` is a delivery envelope. Re-ingesting it must route the underlying child
      // identities rather than treating the subscribed parent as the changed file.
      for (let index = current.changes.length - 1; index >= 0; index -= 1) {
        pending.push(current.changes[index] as FileSystemWatchEvent)
      }
    } else {
      result.push(current)
    }
  }
  return result
}

function eventParentKeys(event: FileSystemWatchEvent): string[] {
  return uniqueRefKeys([event.oldParent, event.newParent])
}

function eventIdentityKey(event: FileSystemWatchEvent): string {
  return JSON.stringify([
    fileRefKey(event.ref),
    event.entryId ?? null,
    event.oldParent ? fileRefKey(event.oldParent) : null,
    event.newParent ? fileRefKey(event.newParent) : null,
  ])
}

function eventsMayShareDirectoryEntry(
  previous: FileSystemWatchEvent,
  next: FileSystemWatchEvent,
): boolean {
  if (fileRefKey(previous.ref) !== fileRefKey(next.ref)) return false
  if (
    previous.entryId !== undefined &&
    next.entryId !== undefined &&
    previous.entryId !== next.entryId
  ) {
    return false
  }
  const previousParents = eventParentKeys(previous)
  const nextParents = eventParentKeys(next)
  if (previousParents.length === 0 || nextParents.length === 0) return true
  const previousSet = new Set(previousParents)
  return nextParents.some((parent) => previousSet.has(parent))
}

/**
 * provider 内可复用的增量事件总线：按目标 FileRef 与 old/new parent 路由；显式 batch 内相同
 * 子项合并，同一父目录命中的多个子项只触发一次回调并放入 changes。
 */
export class FileSystemWatchEventHub {
  private readonly subscriptions = new Map<string, Set<WatchSubscription>>()
  private readonly pending = new Map<string, FileSystemWatchEvent>()
  private readonly pendingByRef = new Map<string, Set<string>>()
  private readonly pendingByRefEntry = new Map<string, Set<string>>()
  private batchDepth = 0

  watch(ref: FileRef, notify: (event: FileSystemWatchEvent) => void): FileSystemWatchHandle {
    const key = fileRefKey(ref)
    const subscription: WatchSubscription = { ref, notify, active: true }
    const listeners = this.subscriptions.get(key) ?? new Set<WatchSubscription>()
    listeners.add(subscription)
    this.subscriptions.set(key, listeners)
    return {
      dispose: () => {
        if (!subscription.active) return
        subscription.active = false
        listeners.delete(subscription)
        if (listeners.size === 0) this.subscriptions.delete(key)
      },
    }
  }

  emit(event: FileSystemWatchEvent): void {
    const events = atomicEvents(event)
    if (events.length === 0) return
    if (this.batchDepth === 0 && events.length === 1) {
      this.deliver(events)
      return
    }

    if (this.batchDepth === 0) {
      this.batch(() => {
        for (const atomic of events) this.queue(atomic)
      })
      return
    }
    for (const atomic of events) this.queue(atomic)
  }

  emitMany(events: readonly FileSystemWatchEvent[]): void {
    this.batch(() => {
      for (const event of events) this.emit(event)
    })
  }

  batch<T>(operation: () => T): T {
    this.batchDepth += 1
    try {
      return operation()
    } finally {
      this.batchDepth -= 1
      if (this.batchDepth === 0) this.flush()
    }
  }

  flush(): void {
    if (this.batchDepth > 0) return
    if (this.pending.size === 0) return
    const events = [...this.pending.values()]
    this.pending.clear()
    this.pendingByRef.clear()
    this.pendingByRefEntry.clear()
    this.deliver(events)
  }

  clear(): void {
    for (const listeners of this.subscriptions.values()) {
      for (const subscription of listeners) subscription.active = false
    }
    this.subscriptions.clear()
    this.pending.clear()
    this.pendingByRef.clear()
    this.pendingByRefEntry.clear()
  }

  private queue(event: FileSystemWatchEvent): void {
    // entryId is only parent-scoped. The same target and entryId under two unrelated parents are
    // distinct links, while a parent-less ref-level change may join one unambiguous pending link.
    const exactKey = eventIdentityKey(event)
    const exact = this.pending.get(exactKey)
    if (exact) {
      this.pending.set(exactKey, mergeEvent(exact, event))
      return
    }
    const candidates = [...this.candidateKeys(event)].flatMap((key) => {
      const previous = this.pending.get(key)
      return previous && eventsMayShareDirectoryEntry(previous, event)
        ? ([[key, previous]] as const)
        : []
    })
    if (candidates.length === 1) {
      const [key, previous] = candidates[0] as [string, FileSystemWatchEvent]
      this.pending.set(key, mergeEvent(previous, event))
      return
    }
    this.pending.set(exactKey, event)
    this.indexPending(exactKey, event)
  }

  private candidateKeys(event: FileSystemWatchEvent): ReadonlySet<string> {
    const ref = fileRefKey(event.ref)
    if (event.entryId === undefined) return this.pendingByRef.get(ref) ?? new Set()
    const keys = new Set(this.pendingByRefEntry.get(JSON.stringify([ref, event.entryId])) ?? [])
    for (const key of this.pendingByRefEntry.get(JSON.stringify([ref, null])) ?? []) keys.add(key)
    return keys
  }

  private indexPending(key: string, event: FileSystemWatchEvent): void {
    const ref = fileRefKey(event.ref)
    const refKeys = this.pendingByRef.get(ref) ?? new Set<string>()
    refKeys.add(key)
    this.pendingByRef.set(ref, refKeys)
    const refEntry = JSON.stringify([ref, event.entryId ?? null])
    const entryKeys = this.pendingByRefEntry.get(refEntry) ?? new Set<string>()
    entryKeys.add(key)
    this.pendingByRefEntry.set(refEntry, entryKeys)
  }

  private deliver(events: readonly FileSystemWatchEvent[]): void {
    const deliveries = new Map<WatchSubscription, FileSystemWatchEvent[]>()
    for (const event of events) {
      for (const key of routedRefKeys(event)) {
        for (const subscription of this.subscriptions.get(key) ?? []) {
          if (!subscription.active) continue
          const queued = deliveries.get(subscription) ?? []
          queued.push(event)
          deliveries.set(subscription, queued)
        }
      }
    }

    for (const [subscription, changes] of deliveries) {
      if (!subscription.active) continue
      const event: FileSystemWatchEvent =
        changes.length === 1
          ? (changes[0] as FileSystemWatchEvent)
          : { type: "changed", ref: subscription.ref, changes }
      try {
        subscription.notify(event)
      } catch {
        // provider 变更已经提交；一个 listener 不能阻断同批次的其它 listener。
      }
    }
  }
}

/** 将多个 provider watch 组合成一个句柄；不支持 watch 的来源不会影响其余订阅。 */
export function watchFileSet(
  refs: readonly FileRef[],
  ctx: FileSystemAccessContext,
  notify: (event: FileSystemWatchEvent) => void,
): FileSystemWatchHandle | null {
  const handles: FileSystemWatchHandle[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const key = fileRefKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const handle = watchFile(ref, ctx, notify)
      if (handle) handles.push(handle)
    } catch {
      // watch 是可选能力；一次不支持不应撤销其他来源的有效订阅。
    }
  }
  if (handles.length === 0) return null
  return {
    dispose() {
      for (const handle of handles.splice(0)) safeDispose(handle)
    },
  }
}
