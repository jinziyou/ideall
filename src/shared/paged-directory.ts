import { isFileRef, type DirectoryEntry, type FileRef } from "@protocol/file-system"
import {
  DIRECTORY_PAGE_SIZE,
  MAX_DIRECTORY_ENTRIES,
  MAX_DIRECTORY_PAGES,
} from "@/filesystem/directory-pagination"
import type { DirectoryPage, FileSystemWatchHandle, ReadDirectoryOptions } from "@/filesystem/types"

export type PagedDirectoryPage = Readonly<{
  cursor?: string
  entries: readonly DirectoryEntry[]
}>

export type PagedDirectorySnapshot = Readonly<{
  pages: readonly PagedDirectoryPage[]
  nextCursor?: string
  loading: boolean
  loadingMore: boolean
  error: unknown | null
  /** 初始读取、显式 reset、watch 失效或 provider revision 重连时递增。 */
  resetVersion: number
}>

export type PagedDirectoryGateway = Readonly<{
  read(ref: FileRef, options: ReadDirectoryOptions): Promise<DirectoryPage>
  watch(ref: FileRef, notify: () => void): FileSystemWatchHandle | null
}>

export type PagedDirectoryControllerOptions = Readonly<{
  pageSize?: number
  maxPages?: number
  maxEntries?: number
  seed?: PagedDirectorySnapshot
}>

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

function validEntry(value: DirectoryEntry): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof value.entryId === "string" &&
    value.entryId.length > 0 &&
    isFileRef(value.parent) &&
    isFileRef(value.target) &&
    typeof value.name === "string" &&
    (value.kind === "child" || value.kind === "link" || value.kind === "mount")
  )
}

function pageEntries(
  page: DirectoryPage,
  seenEntryIds: ReadonlySet<string>,
  maxEntries: number,
): DirectoryEntry[] {
  if (!page || typeof page !== "object" || !Array.isArray(page.entries)) {
    throw new Error("Directory provider returned an invalid page")
  }
  if (page.entries.length > maxEntries) {
    throw new Error(`Directory page exceeded ${maxEntries} entries`)
  }
  const seen = new Set(seenEntryIds)
  const entries: DirectoryEntry[] = []
  for (const entry of page.entries) {
    if (!validEntry(entry)) throw new Error("Directory provider returned an invalid entry")
    if (seen.has(entry.entryId)) continue
    seen.add(entry.entryId)
    entries.push(entry)
  }
  return entries
}

function validatedNextCursor(
  page: DirectoryPage,
  requestedCursor: string | undefined,
  seenCursors: ReadonlySet<string>,
): string | undefined {
  const cursor = page.nextCursor
  if (cursor === undefined) return undefined
  if (typeof cursor !== "string" || !cursor) {
    throw new Error("Directory provider returned an invalid next cursor")
  }
  if (cursor === requestedCursor || seenCursors.has(cursor)) {
    throw new Error(`Directory pagination cursor loop detected at ${JSON.stringify(cursor)}`)
  }
  return cursor
}

function entryIds(pages: readonly PagedDirectoryPage[]): Set<string> {
  return new Set(pages.flatMap((page) => page.entries.map((entry) => entry.entryId)))
}

function entryCount(pages: readonly PagedDirectoryPage[]): number {
  return pages.reduce((total, page) => total + page.entries.length, 0)
}

const EMPTY_SNAPSHOT: PagedDirectorySnapshot = {
  pages: [],
  loading: false,
  loadingMore: false,
  error: null,
  resetVersion: 0,
}

/** Cursor 目录的单消费者状态机；UI hook 只负责 registry revision 与 React 生命周期。 */
export class PagedDirectoryController {
  readonly #ref: FileRef
  readonly #gateway: PagedDirectoryGateway
  readonly #publish: (snapshot: PagedDirectorySnapshot) => void
  readonly #pageSize: number
  readonly #maxPages: number
  readonly #maxEntries: number
  #snapshot: PagedDirectorySnapshot
  #seenCursors = new Set<string>()
  #epoch = 0
  #active = false
  #watch: FileSystemWatchHandle | null = null
  #resetInFlight: Promise<boolean> | null = null
  #loadMoreInFlight: Promise<boolean> | null = null
  #resetQueued = false
  #resetMicrotaskQueued = false

  constructor(
    ref: FileRef,
    gateway: PagedDirectoryGateway,
    publish: (snapshot: PagedDirectorySnapshot) => void,
    options: PagedDirectoryControllerOptions = {},
  ) {
    this.#ref = ref
    this.#gateway = gateway
    this.#publish = publish
    this.#pageSize = positiveInteger(options.pageSize ?? DIRECTORY_PAGE_SIZE, "pageSize")
    this.#maxPages = positiveInteger(options.maxPages ?? MAX_DIRECTORY_PAGES, "maxPages")
    this.#maxEntries = positiveInteger(options.maxEntries ?? MAX_DIRECTORY_ENTRIES, "maxEntries")
    const seed = options.seed
    this.#snapshot = seed
      ? {
          pages: seed.pages,
          loading: false,
          loadingMore: false,
          error: seed.error,
          resetVersion: seed.resetVersion,
        }
      : EMPTY_SNAPSHOT
  }

  snapshot(): PagedDirectorySnapshot {
    return this.#snapshot
  }

  start(): Promise<boolean> {
    if (this.#active) return this.#resetInFlight ?? Promise.resolve(false)
    this.#active = true
    try {
      this.#watch = this.#gateway.watch(this.#ref, () => this.#scheduleReset())
    } catch {
      // watch 是可选能力；provider registry revision 会重建 controller 并再次尝试。
    }
    return this.reset()
  }

  reset(): Promise<boolean> {
    if (!this.#active) return Promise.resolve(false)
    if (this.#resetInFlight) {
      this.#resetQueued = true
      return this.#resetInFlight
    }
    const pending = this.#performReset().finally(() => {
      if (this.#resetInFlight === pending) this.#resetInFlight = null
      if (this.#active && this.#resetQueued) {
        this.#resetQueued = false
        this.#scheduleReset()
      }
    })
    this.#resetInFlight = pending
    return pending
  }

  loadMore(): Promise<boolean> {
    if (!this.#active || this.#snapshot.loading || this.#snapshot.nextCursor === undefined) {
      return Promise.resolve(false)
    }
    if (this.#loadMoreInFlight) return this.#loadMoreInFlight
    const epoch = this.#epoch
    const cursor = this.#snapshot.nextCursor
    this.#commit({ ...this.#snapshot, loadingMore: true, error: null })
    let read: Promise<DirectoryPage>
    try {
      read = this.#gateway.read(this.#ref, { limit: this.#pageSize, cursor })
    } catch (error) {
      read = Promise.reject(error)
    }
    const pending = read
      .then((page) => {
        if (!this.#active || epoch !== this.#epoch) return false
        if (this.#snapshot.pages.length >= this.#maxPages) {
          throw new Error(`Directory pagination exceeded ${this.#maxPages} pages`)
        }
        const knownEntryIds = entryIds(this.#snapshot.pages)
        const entries = pageEntries(page, knownEntryIds, this.#maxEntries)
        if (entryCount(this.#snapshot.pages) + entries.length > this.#maxEntries) {
          throw new Error(`Directory pagination exceeded ${this.#maxEntries} entries`)
        }
        const nextCursor = validatedNextCursor(page, cursor, this.#seenCursors)
        if (nextCursor !== undefined) this.#seenCursors.add(nextCursor)
        const pages = [...this.#snapshot.pages, { cursor, entries }]
        this.#commit({
          pages,
          ...(nextCursor === undefined ? {} : { nextCursor }),
          loading: false,
          loadingMore: false,
          error: null,
          resetVersion: this.#snapshot.resetVersion,
        })
        return true
      })
      .catch((error) => {
        if (this.#active && epoch === this.#epoch) {
          this.#commit({ ...this.#snapshot, loadingMore: false, error })
        }
        return false
      })
      .finally(() => {
        if (this.#loadMoreInFlight === pending) this.#loadMoreInFlight = null
      })
    this.#loadMoreInFlight = pending
    return pending
  }

  dispose(): void {
    if (!this.#active) return
    this.#active = false
    this.#epoch += 1
    this.#resetQueued = false
    this.#resetMicrotaskQueued = false
    const watch = this.#watch
    this.#watch = null
    try {
      watch?.dispose()
    } catch {
      // 清理 best-effort；epoch 已先使所有迟到请求失效。
    }
  }

  async #performReset(): Promise<boolean> {
    const epoch = ++this.#epoch
    // reset 使旧 cursor 请求立即失效；不要让一个迟迟不返回的旧 loadMore 阻塞新页游标。
    this.#loadMoreInFlight = null
    this.#seenCursors = new Set()
    const resetVersion = this.#snapshot.resetVersion + 1
    this.#commit({
      pages: this.#snapshot.pages,
      loading: true,
      loadingMore: false,
      error: null,
      resetVersion,
    })
    try {
      const page = await this.#gateway.read(this.#ref, { limit: this.#pageSize })
      if (!this.#active || epoch !== this.#epoch) return false
      const entries = pageEntries(page, new Set(), this.#maxEntries)
      const nextCursor = validatedNextCursor(page, undefined, this.#seenCursors)
      if (nextCursor !== undefined) this.#seenCursors.add(nextCursor)
      this.#commit({
        pages: [{ entries }],
        ...(nextCursor === undefined ? {} : { nextCursor }),
        loading: false,
        loadingMore: false,
        error: null,
        resetVersion,
      })
      return true
    } catch (error) {
      if (this.#active && epoch === this.#epoch) {
        // reset 后旧 cursor 不再可信，但 last-good 页仍可读；显式 reset 可重试。
        this.#commit({
          pages: this.#snapshot.pages,
          loading: false,
          loadingMore: false,
          error,
          resetVersion,
        })
      }
      return false
    }
  }

  #scheduleReset(): void {
    if (!this.#active || this.#resetMicrotaskQueued) return
    this.#resetMicrotaskQueued = true
    queueMicrotask(() => {
      this.#resetMicrotaskQueued = false
      if (!this.#active) return
      if (this.#resetInFlight) {
        this.#resetQueued = true
        return
      }
      void this.reset()
    })
  }

  #commit(snapshot: PagedDirectorySnapshot): void {
    this.#snapshot = snapshot
    this.#publish(snapshot)
  }
}
