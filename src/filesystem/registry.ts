import type { FileRef, IdeallFile } from "@protocol/file-system"
import type {
  DirectoryPage,
  FileAction,
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

/**
 * 按文件系统实例 id 分派。多个 local/remote/App provider 可以同时存在，只要实例 id 不同。
 */
export class FileSystemRegistry {
  private readonly providers = new Map<string, FileSystemProvider>()

  register(provider: FileSystemProvider): () => void {
    validateProvider(provider)
    const id = provider.descriptor.fileSystemId
    if (this.providers.has(id)) {
      throw new FileSystemError("already-exists", `File system already registered: ${id}`)
    }
    this.providers.set(id, provider)

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.providers.get(id) === provider) this.providers.delete(id)
    }
  }

  get(fileSystemId: string): FileSystemProvider | null {
    return this.providers.get(fileSystemId) ?? null
  }

  require(fileSystemId: string): FileSystemProvider {
    const provider = this.get(fileSystemId)
    if (!provider) {
      throw new FileSystemError("unavailable", `No file system registered: ${fileSystemId}`)
    }
    return provider
  }

  list(): FileSystemProvider[] {
    return [...this.providers.values()]
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
    return this.require(ref.fileSystemId).watch?.(ref, ctx, notify) ?? null
  }

  clear(): void {
    this.providers.clear()
  }
}

export const fileSystemRegistry = new FileSystemRegistry()

export function registerFileSystem(provider: FileSystemProvider): () => void {
  return fileSystemRegistry.register(provider)
}

export function getFileSystem(fileSystemId: string): FileSystemProvider | null {
  return fileSystemRegistry.get(fileSystemId)
}

export function listFileSystems(): FileSystemProvider[] {
  return fileSystemRegistry.list()
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
