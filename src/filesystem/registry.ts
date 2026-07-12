import { fileRefKey, type FileRef, type IdeallFile } from "@protocol/file-system"
import { mapConcurrentOrdered } from "@/lib/map-concurrent-ordered"
import type {
  DirectoryPage,
  FileAction,
  FileReadManyOptions,
  FileReadOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchEvent,
  FileSystemWatchHandle,
  FileWriteInput,
  ReadDirectoryOptions,
} from "./types"
import { FileSystemError } from "./types"

const DEFAULT_READ_CONCURRENCY = 4
const MAX_READ_CONCURRENCY = 32

function readConcurrency(value: number | undefined): number {
  const concurrency = value ?? DEFAULT_READ_CONCURRENCY
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_READ_CONCURRENCY) {
    throw new FileSystemError(
      "invalid-input",
      `Read concurrency must be an integer between 1 and ${MAX_READ_CONCURRENCY}`,
    )
  }
  return concurrency
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
    return this.require(ref.fileSystemId).stat(ref, ctx)
  }

  async readDirectory(
    ref: FileRef,
    ctx: FileSystemAccessContext,
    options?: ReadDirectoryOptions,
  ): Promise<DirectoryPage> {
    return this.require(ref.fileSystemId).readDirectory(ref, ctx, options)
  }

  async read(
    ref: FileRef,
    ctx: FileSystemAccessContext,
    options?: FileReadOptions,
  ): Promise<FileReadResult> {
    return this.require(ref.fileSystemId).read(ref, ctx, options)
  }

  async readMany(
    refs: readonly FileRef[],
    ctx: FileSystemAccessContext,
    options?: FileReadManyOptions,
  ): Promise<Array<FileReadResult | null>> {
    if (refs.length === 0) return []
    const concurrency = readConcurrency(options?.concurrency)
    const readOptions: FileReadOptions = {
      ...(options?.encoding ? { encoding: options.encoding } : {}),
      ...(options?.range ? { range: options.range } : {}),
    }
    const groups = new Map<
      string,
      { owner: ProviderGeneration; items: Array<{ ref: FileRef; index: number }> }
    >()
    refs.forEach((ref, index) => {
      const owner = this.requireGeneration(ref.fileSystemId)
      const current = groups.get(ref.fileSystemId)
      if (current) current.items.push({ ref, index })
      else groups.set(ref.fileSystemId, { owner, items: [{ ref, index }] })
    })

    const results = new Array<FileReadResult | null>(refs.length)
    // provider 分组串行处理，避免多个远端挂载同时各自打满并发窗口。
    for (const { owner, items } of groups.values()) {
      const { provider } = owner
      const providerRefs = items.map((item) => item.ref)
      const firstRef = providerRefs[0]
      this.assertCurrentGeneration(owner, firstRef)
      let values: Array<FileReadResult | null>
      if (provider.readMany) {
        try {
          values = await provider.readMany(providerRefs, ctx, options)
        } catch (error) {
          // replacement/unregister wins over a late result or error from the retired provider.
          this.assertCurrentGeneration(owner, firstRef)
          throw error
        }
        this.assertCurrentGeneration(owner, firstRef)
        if (!Array.isArray(values) || values.length !== providerRefs.length) {
          throw new FileSystemError(
            "unavailable",
            `File system ${provider.descriptor.fileSystemId} returned ${Array.isArray(values) ? values.length : "a non-array batch"} for ${providerRefs.length} refs`,
            firstRef,
          )
        }
        for (let index = 0; index < values.length; index += 1) {
          if (!Object.prototype.hasOwnProperty.call(values, index) || values[index] === undefined) {
            throw new FileSystemError(
              "unavailable",
              `File system ${provider.descriptor.fileSystemId} returned an undefined batch result at index ${index}`,
              providerRefs[index],
            )
          }
        }
      } else {
        values = await mapConcurrentOrdered(providerRefs, concurrency, async (ref) => {
          this.assertCurrentGeneration(owner, ref)
          try {
            const value = await provider.read(ref, ctx, readOptions)
            this.assertCurrentGeneration(owner, ref)
            return value
          } catch (error) {
            this.assertCurrentGeneration(owner, ref)
            if (error instanceof FileSystemError && error.code === "not-found") return null
            throw error
          }
        })
        this.assertCurrentGeneration(owner, firstRef)
      }
      items.forEach((item, index) => {
        results[item.index] = values[index] as FileReadResult | null
      })
    }
    return results
  }

  async write(
    ref: FileRef,
    input: FileWriteInput,
    ctx: FileSystemAccessContext,
  ): Promise<IdeallFile> {
    return this.require(ref.fileSystemId).write(ref, input, ctx)
  }

  async actions(ref: FileRef, ctx: FileSystemAccessContext): Promise<FileAction[]> {
    return this.require(ref.fileSystemId).actions(ref, ctx)
  }

  async invoke(
    ref: FileRef,
    action: string,
    input: unknown,
    ctx: FileSystemAccessContext,
  ): Promise<unknown> {
    return this.require(ref.fileSystemId).invoke(ref, action, input, ctx)
  }

  watch(
    ref: FileRef,
    ctx: FileSystemAccessContext,
    notify: (event: FileSystemWatchEvent) => void,
  ): FileSystemWatchHandle | null {
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
      const providerHandle = owner.provider.watch(ref, ctx, (event) => {
        this.dispatchWatchEvent(group as ProviderWatchGroup, event)
      })
      if (!providerHandle) {
        this.deactivateWatchGroup(group)
        return null
      }
      // provider.watch 允许同步回调；该回调也可能触发卸载。返回后再次核对 generation。
      if (!owner.active || !group.active || this.providers.get(ref.fileSystemId) !== owner) {
        safeDispose(providerHandle)
        this.deactivateWatchGroup(group)
        return null
      }
      group.providerHandle = providerHandle
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

  private dispatchWatchEvent(group: ProviderWatchGroup, event: FileSystemWatchEvent): void {
    const { owner } = group
    const id = owner.provider.descriptor.fileSystemId
    if (!owner.active || !group.active || this.providers.get(id) !== owner) return
    for (const subscriber of [...group.subscribers]) {
      if (!subscriber.active) continue
      try {
        subscriber.notify(event)
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
): Promise<unknown> {
  return fileSystemRegistry.invoke(ref, action, input, ctx)
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
