import {
  FILE_SOURCE_KINDS,
  fileRefKey,
  sameFileRef,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import { mapConcurrentOrdered } from "@/lib/map-concurrent-ordered"
import type {
  DirectoryPage,
  FileAction,
  FileActionInvokeOptions,
  FileReadManyOptions,
  FileReadOptions,
  FileReadResult,
  FileStatManyOptions,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchEvent,
  FileSystemWatchHandle,
  FileWriteInput,
  ReadDirectoryOptions,
} from "./types"
import { FileSystemError } from "./types"

const DEFAULT_BATCH_CONCURRENCY = 4
const MAX_BATCH_CONCURRENCY = 32
const MAX_BATCH_REFS = 10_000
const MAX_WATCH_EVENTS = 10_000

const fileSourceKinds = new Set<string>(FILE_SOURCE_KINDS)
const fileKinds = new Set(["file", "directory"])
const directoryEntryKinds = new Set(["child", "link", "mount"])
const watchEventTypes = new Set(["changed", "created", "deleted", "mount-changed"])

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function snapshotFileRef(value: unknown): FileRef | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  try {
    const candidate = value as Partial<FileRef>
    const fileSystemId = candidate.fileSystemId
    const fileId = candidate.fileId
    return typeof fileSystemId === "string" &&
      fileSystemId.length > 0 &&
      typeof fileId === "string" &&
      fileId.length > 0
      ? { fileSystemId, fileId }
      : null
  } catch {
    return null
  }
}

function invalidInput(message: string): never {
  throw new FileSystemError("invalid-input", message)
}

function validateInputRef(value: unknown, operation: string): asserts value is FileRef {
  if (!snapshotFileRef(value)) {
    invalidInput(`${operation} requires a valid FileRef`)
  }
}

function validatedBatchRefs(value: unknown, operation: "Read" | "Stat"): FileRef[] {
  if (!Array.isArray(value)) invalidInput(`${operation} refs must be an array`)
  let length: number
  try {
    length = value.length
  } catch {
    invalidInput(`${operation} refs must be a readable array`)
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    invalidInput(`${operation} refs must have a valid array length`)
  }
  if (length > MAX_BATCH_REFS) {
    invalidInput(`${operation} accepts at most ${MAX_BATCH_REFS} refs`)
  }
  const refs = new Array<FileRef>(length)
  for (let index = 0; index < length; index += 1) {
    let ref: FileRef | null = null
    try {
      if (hasOwn(value, index)) ref = snapshotFileRef(value[index])
    } catch {
      // 下面统一映射成调用方 invalid-input，且不会触达 provider。
    }
    if (!ref) {
      invalidInput(`${operation} refs contains an invalid FileRef at index ${index}`)
    }
    refs[index] = ref
  }
  return refs
}

function batchConcurrency(value: number | undefined, operation: "Read" | "Stat"): number {
  const concurrency = value ?? DEFAULT_BATCH_CONCURRENCY
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_BATCH_CONCURRENCY
  ) {
    throw new FileSystemError(
      "invalid-input",
      `${operation} concurrency must be an integer between 1 and ${MAX_BATCH_CONCURRENCY}`,
    )
  }
  return concurrency
}

function isValidCapabilities(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!hasOwn(value, index) || typeof value[index] !== "string") return false
  }
  return true
}

function isValidFileSource(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  return (
    typeof value.kind === "string" &&
    fileSourceKinds.has(value.kind) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (value.label === undefined || typeof value.label === "string") &&
    (value.readOnly === undefined || typeof value.readOnly === "boolean")
  )
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value))
}

function isValidIdeallFile(value: unknown, expectedRef: FileRef): value is IdeallFile {
  try {
    if (!isPlainRecord(value)) return false
    if (!hasOwn(value, "ref")) return false
    const outputRef = snapshotFileRef(value.ref)
    if (
      !outputRef ||
      !sameFileRef(outputRef, expectedRef) ||
      !hasOwn(value, "kind") ||
      typeof value.kind !== "string" ||
      !fileKinds.has(value.kind) ||
      !hasOwn(value, "name") ||
      typeof value.name !== "string" ||
      !hasOwn(value, "mediaType") ||
      typeof value.mediaType !== "string" ||
      value.mediaType.length === 0 ||
      !hasOwn(value, "capabilities") ||
      !isValidCapabilities(value.capabilities) ||
      !hasOwn(value, "source") ||
      !isValidFileSource(value.source) ||
      !isOptionalFiniteNumber(value.size) ||
      (typeof value.size === "number" && value.size < 0) ||
      !isOptionalFiniteNumber(value.createdAt) ||
      !isOptionalFiniteNumber(value.updatedAt) ||
      (value.version !== undefined && typeof value.version !== "string") ||
      (value.properties !== undefined && !isPlainRecord(value.properties))
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function malformedProviderOutput(
  providerId: string,
  operation: string,
  ref: FileRef,
): FileSystemError {
  return new FileSystemError(
    "unavailable",
    `File system ${providerId} returned malformed output from ${operation}`,
    ref,
  )
}

function validatedFileResult(
  providerId: string,
  operation: string,
  ref: FileRef,
  value: unknown,
  nullable: boolean,
): IdeallFile | null {
  if (nullable && value === null) return null
  if (!isValidIdeallFile(value, ref)) {
    throw malformedProviderOutput(providerId, operation, ref)
  }
  return value
}

function isValidReadResult(value: unknown): value is FileReadResult {
  try {
    return (
      isPlainRecord(value) &&
      hasOwn(value, "data") &&
      hasOwn(value, "mediaType") &&
      typeof value.mediaType === "string" &&
      value.mediaType.length > 0 &&
      isOptionalFiniteNumber(value.size) &&
      !(typeof value.size === "number" && value.size < 0) &&
      (value.version === undefined || typeof value.version === "string")
    )
  } catch {
    return false
  }
}

function validatedReadResult(
  providerId: string,
  operation: string,
  ref: FileRef,
  value: unknown,
  nullable: boolean,
): FileReadResult | null {
  if (nullable && value === null) return null
  if (!isValidReadResult(value)) {
    throw malformedProviderOutput(providerId, operation, ref)
  }
  return value
}

function isValidDirectoryEntry(
  value: unknown,
  requestedRef: FileRef,
  recursive: boolean,
): string | null {
  try {
    if (!isPlainRecord(value)) return null
    const entryId = value.entryId
    const parent = snapshotFileRef(value.parent)
    const target = snapshotFileRef(value.target)
    if (
      typeof entryId !== "string" ||
      !parent ||
      (!recursive && !sameFileRef(parent, requestedRef)) ||
      !target ||
      typeof value.name !== "string" ||
      typeof value.kind !== "string" ||
      !directoryEntryKinds.has(value.kind) ||
      (value.pathName !== undefined && typeof value.pathName !== "string") ||
      (value.sortKey !== undefined && typeof value.sortKey !== "string") ||
      (value.properties !== undefined && !isPlainRecord(value.properties)) ||
      (value.file !== undefined && !isValidIdeallFile(value.file, target))
    ) {
      return null
    }
    return JSON.stringify([fileRefKey(parent), entryId])
  } catch {
    return null
  }
}

function validatedDirectoryPage(
  providerId: string,
  ref: FileRef,
  value: unknown,
  recursive: boolean,
): DirectoryPage {
  try {
    if (!isPlainRecord(value)) {
      throw malformedProviderOutput(providerId, "readDirectory", ref)
    }
    const entries = value.entries
    const nextCursor = value.nextCursor
    if (!Array.isArray(entries)) {
      throw malformedProviderOutput(providerId, "readDirectory", ref)
    }
    if (nextCursor !== undefined && typeof nextCursor !== "string") {
      throw malformedProviderOutput(providerId, "readDirectory", ref)
    }
    const entryCount = entries.length
    const validatedEntries = new Array<DirectoryPage["entries"][number]>(entryCount)
    const entryIdentities = new Set<string>()
    for (let index = 0; index < entryCount; index += 1) {
      if (!hasOwn(entries, index)) {
        throw malformedProviderOutput(providerId, "readDirectory", ref)
      }
      const entry = entries[index]
      const entryIdentity = isValidDirectoryEntry(entry, ref, recursive)
      if (entryIdentity === null || entryIdentities.has(entryIdentity)) {
        throw malformedProviderOutput(providerId, "readDirectory", ref)
      }
      entryIdentities.add(entryIdentity)
      validatedEntries[index] = entry as DirectoryPage["entries"][number]
    }
    return nextCursor === undefined
      ? { entries: validatedEntries }
      : { entries: validatedEntries, nextCursor }
  } catch {
    throw malformedProviderOutput(providerId, "readDirectory", ref)
  }
}

function validatedProviderBatch(
  providerId: string,
  operation: string,
  ref: FileRef,
  value: unknown,
  expectedLength: number,
): unknown[] {
  try {
    if (!Array.isArray(value) || value.length !== expectedLength) {
      throw malformedProviderOutput(providerId, operation, ref)
    }
    const snapshot = new Array<unknown>(expectedLength)
    for (let index = 0; index < expectedLength; index += 1) {
      if (!hasOwn(value, index)) throw malformedProviderOutput(providerId, operation, ref)
      const item = value[index]
      if (item === undefined) throw malformedProviderOutput(providerId, operation, ref)
      snapshot[index] = item
    }
    return snapshot
  } catch {
    throw malformedProviderOutput(providerId, operation, ref)
  }
}

function validatedWatchEvent(value: unknown): FileSystemWatchEvent | null {
  try {
    const pending: Array<{ value: unknown; exiting: boolean }> = [{ value, exiting: false }]
    const states = new Map<object, "visiting" | "validated">()
    let eventCount = 0
    let scheduledEvents = 1
    while (pending.length > 0) {
      const frame = pending.pop() as { value: unknown; exiting: boolean }
      if (frame.exiting) {
        states.set(frame.value as object, "validated")
        continue
      }
      const current = frame.value
      if (!isPlainRecord(current)) return null
      const state = states.get(current)
      if (state === "visiting") return null
      if (state === "validated") continue
      states.set(current, "visiting")
      eventCount += 1
      if (eventCount > MAX_WATCH_EVENTS) return null
      const type = current.type
      const eventRef = snapshotFileRef(current.ref)
      const entryId = current.entryId
      const oldParent = current.oldParent
      const newParent = current.newParent
      const version = current.version
      const changes = current.changes
      if (
        typeof type !== "string" ||
        !watchEventTypes.has(type) ||
        !eventRef ||
        (entryId !== undefined && typeof entryId !== "string") ||
        (oldParent !== undefined && !snapshotFileRef(oldParent)) ||
        (newParent !== undefined && !snapshotFileRef(newParent)) ||
        (version !== undefined && typeof version !== "string")
      ) {
        return null
      }
      pending.push({ value: current, exiting: true })
      if (changes === undefined) continue
      if (!Array.isArray(changes)) return null
      const changeCount = changes.length
      if (scheduledEvents + changeCount > MAX_WATCH_EVENTS) return null
      scheduledEvents += changeCount
      const children = new Array<unknown>(changeCount)
      for (let index = 0; index < changeCount; index += 1) {
        if (!hasOwn(changes, index)) return null
        children[index] = changes[index]
      }
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push({ value: children[index], exiting: false })
      }
    }
    return value as FileSystemWatchEvent
  } catch {
    return null
  }
}

function validatedWatchHandle(value: unknown): FileSystemWatchHandle | null {
  if (value === null || typeof value !== "object") return null
  try {
    const dispose = (value as Partial<FileSystemWatchHandle>).dispose
    return typeof dispose === "function"
      ? { dispose: () => Reflect.apply(dispose, value, []) as void }
      : null
  } catch {
    return null
  }
}

function validateProvider(provider: FileSystemProvider): void {
  const { descriptor } = provider
  if (!descriptor.fileSystemId) {
    throw new FileSystemError("invalid-input", "File system id cannot be empty")
  }
  if (!descriptor.name) {
    throw new FileSystemError("invalid-input", "File system name cannot be empty")
  }
  if (descriptor.root.fileSystemId !== descriptor.fileSystemId || !descriptor.root.fileId) {
    throw new FileSystemError(
      "invalid-input",
      `File system root must belong to ${descriptor.fileSystemId}`,
      descriptor.root,
    )
  }
}

type WatchSubscriber = {
  readonly notify: (event: FileSystemWatchEvent) => void
  active: boolean
}

type ProviderGeneration = {
  readonly provider: FileSystemProvider
  readonly generation: number
  readonly watchGroups: Map<string, ProviderWatchGroup>
  active: boolean
}

type ProviderWatchGroup = {
  readonly owner: ProviderGeneration
  readonly key: string
  readonly ref: FileRef
  readonly subscribers: Set<WatchSubscriber>
  providerHandle: FileSystemWatchHandle | null
  active: boolean
}

type ProviderBatchItem = {
  readonly ref: FileRef
  readonly resultIndices: number[]
}

type ProviderBatchGroup = {
  readonly owner: ProviderGeneration
  readonly items: ProviderBatchItem[]
  readonly itemsByRef: Map<string, ProviderBatchItem>
}

function safeDispose(handle: FileSystemWatchHandle | null): void {
  if (!handle) return
  try {
    handle.dispose()
  } catch {
    // provider 已退出当前 generation；清理异常不能阻断其它 watch/provider 的释放。
  }
}

function watchContextKey(ctx: FileSystemAccessContext): string {
  const permissions = [...new Set(ctx.permissions)].sort()
  return JSON.stringify([
    ctx.actor,
    ctx.intent ?? "",
    ctx.activeFile ? fileRefKey(ctx.activeFile) : "",
    permissions,
  ])
}

/**
 * 按文件系统实例 id 分派。多个 local/remote/App provider 可以同时存在，只要实例 id 不同。
 */
export class FileSystemRegistry {
  private readonly providers = new Map<string, ProviderGeneration>()
  private readonly listeners = new Set<() => void>()
  private revisionValue = 0
  private nextGeneration = 1
  private batchDepth = 0
  private notificationPending = false

  register(provider: FileSystemProvider): () => void {
    validateProvider(provider)
    const id = provider.descriptor.fileSystemId
    if (this.providers.has(id)) {
      throw new FileSystemError("already-exists", `File system already registered: ${id}`)
    }
    const owner = this.createGeneration(provider)
    this.providers.set(id, owner)
    this.notify()

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.removeGeneration(id, owner)
    }
  }

  /** 原子替换同 id provider；旧 generation 的 watch 会先失效并 best-effort 释放。 */
  replace(provider: FileSystemProvider): () => void {
    validateProvider(provider)
    const id = provider.descriptor.fileSystemId
    const previous = this.providers.get(id)
    const owner = this.createGeneration(provider)
    if (previous) previous.active = false
    this.providers.set(id, owner)
    if (previous) this.disposeGenerationWatches(previous)
    this.notify()

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.removeGeneration(id, owner)
    }
  }

  get(fileSystemId: string): FileSystemProvider | null {
    return this.providers.get(fileSystemId)?.provider ?? null
  }

  require(fileSystemId: string): FileSystemProvider {
    const provider = this.get(fileSystemId)
    if (!provider) {
      throw new FileSystemError("unavailable", `No file system registered: ${fileSystemId}`)
    }
    return provider
  }

  list(): FileSystemProvider[] {
    return [...this.providers.values()].map(({ provider }) => provider)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  revision(): number {
    return this.revisionValue
  }

  /** 延迟 provider 集合通知，使运行时扩展安装/回滚只暴露最终状态。 */
  batch<T>(operation: () => T): T {
    this.batchDepth += 1
    try {
      return operation()
    } finally {
      this.batchDepth -= 1
      if (this.batchDepth === 0 && this.notificationPending) {
        this.notificationPending = false
        this.emit()
      }
    }
  }

  async stat(ref: FileRef, ctx: FileSystemAccessContext): Promise<IdeallFile | null> {
    return this.runScalarOperation(ref, async (provider) =>
      validatedFileResult(
        provider.descriptor.fileSystemId,
        "stat",
        ref,
        await provider.stat(ref, ctx),
        true,
      ),
    )
  }

  async statMany(
    refs: readonly FileRef[],
    ctx: FileSystemAccessContext,
    options: FileStatManyOptions = {},
  ): Promise<Array<IdeallFile | null>> {
    const inputRefs = validatedBatchRefs(refs, "Stat")
    if (inputRefs.length === 0) return []
    const concurrency = batchConcurrency(options.concurrency, "Stat")
    const groups = new Map<string, ProviderBatchGroup>()
    for (let index = 0; index < inputRefs.length; index += 1) {
      const ref = inputRefs[index] as FileRef
      const owner = this.requireGeneration(ref.fileSystemId)
      let group = groups.get(ref.fileSystemId)
      if (!group) {
        group = { owner, items: [], itemsByRef: new Map() }
        groups.set(ref.fileSystemId, group)
      }
      const key = fileRefKey(ref)
      const current = group.itemsByRef.get(key)
      if (current) {
        current.resultIndices.push(index)
      } else {
        const item: ProviderBatchItem = { ref, resultIndices: [index] }
        group.items.push(item)
        group.itemsByRef.set(key, item)
      }
    }

    const results = new Array<IdeallFile | null>(inputRefs.length)
    for (const { owner, items } of groups.values()) {
      const { provider } = owner
      const providerRefs = items.map((item) => item.ref)
      const firstRef = providerRefs[0]
      this.assertCurrentGeneration(owner, firstRef)
      let values: Array<IdeallFile | null>
      if (provider.statMany) {
        let rawValues: unknown
        try {
          rawValues = await provider.statMany(providerRefs, ctx, options)
        } catch (error) {
          // replacement/unregister wins over a late result or error from the retired provider.
          this.assertCurrentGeneration(owner, firstRef)
          throw error
        }
        this.assertCurrentGeneration(owner, firstRef)
        const providerValues = validatedProviderBatch(
          provider.descriptor.fileSystemId,
          "statMany",
          firstRef,
          rawValues,
          providerRefs.length,
        )
        values = new Array<IdeallFile | null>(providerValues.length)
        for (let index = 0; index < providerValues.length; index += 1) {
          values[index] = validatedFileResult(
            provider.descriptor.fileSystemId,
            "statMany",
            providerRefs[index] as FileRef,
            providerValues[index],
            true,
          )
        }
      } else {
        try {
          values = await mapConcurrentOrdered(providerRefs, concurrency, async (ref) => {
            this.assertCurrentGeneration(owner, ref)
            try {
              const value = await provider.stat(ref, ctx)
              this.assertCurrentGeneration(owner, ref)
              return validatedFileResult(provider.descriptor.fileSystemId, "stat", ref, value, true)
            } catch (error) {
              this.assertCurrentGeneration(owner, ref)
              if (error instanceof FileSystemError && error.code === "not-found") return null
              throw error
            }
          })
        } catch (error) {
          this.assertCurrentGeneration(owner, firstRef)
          throw error
        }
        this.assertCurrentGeneration(owner, firstRef)
      }
      items.forEach((item, index) => {
        for (const resultIndex of item.resultIndices) {
          results[resultIndex] = values[index] as IdeallFile | null
        }
      })
    }
    return results
  }

  async readDirectory(
    ref: FileRef,
    ctx: FileSystemAccessContext,
    options?: ReadDirectoryOptions,
  ): Promise<DirectoryPage> {
    return this.runScalarOperation(ref, async (provider) =>
      validatedDirectoryPage(
        provider.descriptor.fileSystemId,
        ref,
        await provider.readDirectory(ref, ctx, options),
        options?.recursive === true,
      ),
    )
  }

  async read(
    ref: FileRef,
    ctx: FileSystemAccessContext,
    options?: FileReadOptions,
  ): Promise<FileReadResult> {
    return this.runScalarOperation(ref, async (provider) => {
      const result = validatedReadResult(
        provider.descriptor.fileSystemId,
        "read",
        ref,
        await provider.read(ref, ctx, options),
        false,
      )
      return result as FileReadResult
    })
  }

  async readMany(
    refs: readonly FileRef[],
    ctx: FileSystemAccessContext,
    options?: FileReadManyOptions,
  ): Promise<Array<FileReadResult | null>> {
    const inputRefs = validatedBatchRefs(refs, "Read")
    if (inputRefs.length === 0) return []
    const concurrency = batchConcurrency(options?.concurrency, "Read")
    const readOptions: FileReadOptions = {
      ...(options?.encoding ? { encoding: options.encoding } : {}),
      ...(options?.range ? { range: options.range } : {}),
    }
    const groups = new Map<string, ProviderBatchGroup>()
    for (let index = 0; index < inputRefs.length; index += 1) {
      const ref = inputRefs[index] as FileRef
      const owner = this.requireGeneration(ref.fileSystemId)
      let group = groups.get(ref.fileSystemId)
      if (!group) {
        group = { owner, items: [], itemsByRef: new Map() }
        groups.set(ref.fileSystemId, group)
      }
      const key = fileRefKey(ref)
      const current = group.itemsByRef.get(key)
      if (current) {
        current.resultIndices.push(index)
      } else {
        const item: ProviderBatchItem = { ref, resultIndices: [index] }
        group.items.push(item)
        group.itemsByRef.set(key, item)
      }
    }

    const results = new Array<FileReadResult | null>(inputRefs.length)
    // provider 分组串行处理，避免多个远端挂载同时各自打满并发窗口。
    for (const { owner, items } of groups.values()) {
      const { provider } = owner
      const providerRefs = items.map((item) => item.ref)
      const firstRef = providerRefs[0]
      this.assertCurrentGeneration(owner, firstRef)
      let values: Array<FileReadResult | null>
      if (provider.readMany) {
        let rawValues: unknown
        try {
          rawValues = await provider.readMany(providerRefs, ctx, options)
        } catch (error) {
          // replacement/unregister wins over a late result or error from the retired provider.
          this.assertCurrentGeneration(owner, firstRef)
          throw error
        }
        this.assertCurrentGeneration(owner, firstRef)
        const providerValues = validatedProviderBatch(
          provider.descriptor.fileSystemId,
          "readMany",
          firstRef,
          rawValues,
          providerRefs.length,
        )
        values = new Array<FileReadResult | null>(providerValues.length)
        for (let index = 0; index < providerValues.length; index += 1) {
          values[index] = validatedReadResult(
            provider.descriptor.fileSystemId,
            "readMany",
            providerRefs[index] as FileRef,
            providerValues[index],
            true,
          )
        }
      } else {
        values = await mapConcurrentOrdered(providerRefs, concurrency, async (ref) => {
          this.assertCurrentGeneration(owner, ref)
          try {
            const value = await provider.read(ref, ctx, readOptions)
            this.assertCurrentGeneration(owner, ref)
            return validatedReadResult(
              provider.descriptor.fileSystemId,
              "read",
              ref,
              value,
              false,
            ) as FileReadResult
          } catch (error) {
            this.assertCurrentGeneration(owner, ref)
            if (error instanceof FileSystemError && error.code === "not-found") return null
            throw error
          }
        })
        this.assertCurrentGeneration(owner, firstRef)
      }
      items.forEach((item, index) => {
        for (const resultIndex of item.resultIndices) {
          results[resultIndex] = values[index] as FileReadResult | null
        }
      })
    }
    return results
  }

  async write(
    ref: FileRef,
    input: FileWriteInput,
    ctx: FileSystemAccessContext,
  ): Promise<IdeallFile> {
    return this.runScalarOperation(ref, async (provider) => {
      const result = validatedFileResult(
        provider.descriptor.fileSystemId,
        "write",
        ref,
        await provider.write(ref, input, ctx),
        false,
      )
      return result as IdeallFile
    })
  }

  async actions(ref: FileRef, ctx: FileSystemAccessContext): Promise<FileAction[]> {
    return this.runScalarOperation(ref, (provider) => provider.actions(ref, ctx))
  }

  async invoke(
    ref: FileRef,
    action: string,
    input: unknown,
    ctx: FileSystemAccessContext,
    options?: FileActionInvokeOptions,
  ): Promise<unknown> {
    return this.runScalarOperation(ref, (provider) =>
      provider.invoke(ref, action, input, ctx, options),
    )
  }

  watch(
    ref: FileRef,
    ctx: FileSystemAccessContext,
    notify: (event: FileSystemWatchEvent) => void,
  ): FileSystemWatchHandle | null {
    validateInputRef(ref, "Watch")
    const owner = this.requireGeneration(ref.fileSystemId)
    if (!owner.provider.watch) return null
    const key = `${owner.generation}|${fileRefKey(ref)}|${watchContextKey(ctx)}`
    const subscriber: WatchSubscriber = { notify, active: true }
    let group = owner.watchGroups.get(key)
    if (group) {
      group.subscribers.add(subscriber)
      return this.subscriberHandle(group, subscriber)
    }

    group = {
      owner,
      key,
      ref,
      subscribers: new Set([subscriber]),
      providerHandle: null,
      active: true,
    }
    owner.watchGroups.set(key, group)
    try {
      const providerHandle: unknown = owner.provider.watch(ref, ctx, (event) => {
        this.dispatchWatchEvent(group as ProviderWatchGroup, event)
      })
      if (providerHandle === null) {
        this.deactivateWatchGroup(group)
        return null
      }
      const watchHandle = validatedWatchHandle(providerHandle)
      if (!watchHandle) {
        this.deactivateWatchGroup(group)
        throw malformedProviderOutput(owner.provider.descriptor.fileSystemId, "watch", ref)
      }
      // provider.watch 允许同步回调；该回调也可能触发卸载。返回后再次核对 generation。
      if (!owner.active || !group.active || this.providers.get(ref.fileSystemId) !== owner) {
        safeDispose(watchHandle)
        this.deactivateWatchGroup(group)
        return null
      }
      group.providerHandle = watchHandle
      return this.subscriberHandle(group, subscriber)
    } catch (error) {
      this.deactivateWatchGroup(group)
      throw error
    }
  }

  clear(): void {
    if (this.providers.size === 0) return
    const owners = [...this.providers.values()]
    this.providers.clear()
    for (const owner of owners) {
      owner.active = false
      this.disposeGenerationWatches(owner)
    }
    this.notify()
  }

  private createGeneration(provider: FileSystemProvider): ProviderGeneration {
    return {
      provider,
      generation: this.nextGeneration++,
      watchGroups: new Map(),
      active: true,
    }
  }

  private requireGeneration(fileSystemId: string): ProviderGeneration {
    const owner = this.providers.get(fileSystemId)
    if (!owner) {
      throw new FileSystemError("unavailable", `No file system registered: ${fileSystemId}`)
    }
    return owner
  }

  /**
   * 标量操作绑定调用开始时的 provider generation。provider 被替换或卸载后，其迟到结果和
   * 迟到异常都不能穿过 registry 边界。write/invoke 已产生的外部副作用无法在这里回滚，
   * 但也不能被误报成当前 provider generation 的成功结果。
   */
  private async runScalarOperation<T>(
    ref: FileRef,
    operation: (provider: FileSystemProvider) => Promise<T>,
  ): Promise<T> {
    validateInputRef(ref, "File system operation")
    const owner = this.requireGeneration(ref.fileSystemId)
    this.assertCurrentGeneration(owner, ref)
    let result: T
    try {
      result = await operation(owner.provider)
    } catch (error) {
      // replacement/unregister wins over a late error from the retired provider.
      this.assertCurrentGeneration(owner, ref)
      throw error
    }
    this.assertCurrentGeneration(owner, ref)
    return result
  }

  private assertCurrentGeneration(owner: ProviderGeneration, ref?: FileRef): void {
    const id = owner.provider.descriptor.fileSystemId
    if (owner.active && this.providers.get(id) === owner) return
    throw new FileSystemError(
      "unavailable",
      `File system provider changed while an operation was in flight: ${id}`,
      ref,
    )
  }

  private removeGeneration(id: string, owner: ProviderGeneration): boolean {
    if (this.providers.get(id) !== owner) return false
    owner.active = false
    this.providers.delete(id)
    this.disposeGenerationWatches(owner)
    this.notify()
    return true
  }

  private disposeGenerationWatches(owner: ProviderGeneration): void {
    const groups = [...owner.watchGroups.values()]
    owner.watchGroups.clear()
    for (const group of groups) {
      group.active = false
      for (const subscriber of group.subscribers) subscriber.active = false
      group.subscribers.clear()
      const handle = group.providerHandle
      group.providerHandle = null
      safeDispose(handle)
    }
  }

  private deactivateWatchGroup(group: ProviderWatchGroup): void {
    if (!group.active) return
    group.active = false
    if (group.owner.watchGroups.get(group.key) === group) {
      group.owner.watchGroups.delete(group.key)
    }
    for (const subscriber of group.subscribers) subscriber.active = false
    group.subscribers.clear()
    const handle = group.providerHandle
    group.providerHandle = null
    safeDispose(handle)
  }

  private subscriberHandle(
    group: ProviderWatchGroup,
    subscriber: WatchSubscriber,
  ): FileSystemWatchHandle {
    return {
      dispose: () => {
        if (!subscriber.active) return
        subscriber.active = false
        group.subscribers.delete(subscriber)
        if (group.subscribers.size === 0) this.deactivateWatchGroup(group)
      },
    }
  }

  private dispatchWatchEvent(group: ProviderWatchGroup, event: unknown): void {
    const { owner } = group
    const id = owner.provider.descriptor.fileSystemId
    if (!owner.active || !group.active || this.providers.get(id) !== owner) return
    const validatedEvent = validatedWatchEvent(event)
    if (!validatedEvent) return
    for (const subscriber of [...group.subscribers]) {
      if (!subscriber.active) continue
      try {
        subscriber.notify(validatedEvent)
      } catch {
        // provider mutation 已提交；单个视图 watcher 不能阻断其它 watcher。
      }
    }
  }

  private notify(): void {
    if (this.batchDepth > 0) {
      this.notificationPending = true
      return
    }
    this.emit()
  }

  private emit(): void {
    this.revisionValue += 1
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // Registry 状态已经提交；观察者故障不能破坏 provider 注册或阻断其它观察者。
      }
    }
  }
}

export const fileSystemRegistry = new FileSystemRegistry()

export function registerFileSystem(provider: FileSystemProvider): () => void {
  return fileSystemRegistry.register(provider)
}

export function replaceFileSystem(provider: FileSystemProvider): () => void {
  return fileSystemRegistry.replace(provider)
}

export function getFileSystem(fileSystemId: string): FileSystemProvider | null {
  return fileSystemRegistry.get(fileSystemId)
}

export function listFileSystems(): FileSystemProvider[] {
  return fileSystemRegistry.list()
}

export function subscribeFileSystems(listener: () => void): () => void {
  return fileSystemRegistry.subscribe(listener)
}

export function getFileSystemRevision(): number {
  return fileSystemRegistry.revision()
}

export function statFile(ref: FileRef, ctx: FileSystemAccessContext): Promise<IdeallFile | null> {
  return fileSystemRegistry.stat(ref, ctx)
}

export function statFiles(
  refs: readonly FileRef[],
  ctx: FileSystemAccessContext,
  options?: FileStatManyOptions,
): Promise<Array<IdeallFile | null>> {
  return fileSystemRegistry.statMany(refs, ctx, options)
}

export function readFileDirectory(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  options?: ReadDirectoryOptions,
): Promise<DirectoryPage> {
  return fileSystemRegistry.readDirectory(ref, ctx, options)
}

export function readFile(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  options?: FileReadOptions,
): Promise<FileReadResult> {
  return fileSystemRegistry.read(ref, ctx, options)
}

export function readFiles(
  refs: readonly FileRef[],
  ctx: FileSystemAccessContext,
  options?: FileReadManyOptions,
): Promise<Array<FileReadResult | null>> {
  return fileSystemRegistry.readMany(refs, ctx, options)
}

export function writeFile(
  ref: FileRef,
  input: FileWriteInput,
  ctx: FileSystemAccessContext,
): Promise<IdeallFile> {
  return fileSystemRegistry.write(ref, input, ctx)
}

export function fileActions(ref: FileRef, ctx: FileSystemAccessContext): Promise<FileAction[]> {
  return fileSystemRegistry.actions(ref, ctx)
}

export function invokeFileAction(
  ref: FileRef,
  action: string,
  input: unknown,
  ctx: FileSystemAccessContext,
  options?: FileActionInvokeOptions,
): Promise<unknown> {
  return fileSystemRegistry.invoke(ref, action, input, ctx, options)
}

export function watchFile(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  notify: (event: FileSystemWatchEvent) => void,
): FileSystemWatchHandle | null {
  return fileSystemRegistry.watch(ref, ctx, notify)
}

export function clearFileSystemsForTest(): void {
  fileSystemRegistry.clear()
}
