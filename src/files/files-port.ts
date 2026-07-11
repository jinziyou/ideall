// FilesPort 的兼容领域外观。
//
// 普通 agent/embed CRUD 不再直达 IndexedDB store，而是统一经 FileSystem registry 分派到
// ideall.core provider。FilesPort 暂时保留旧领域类型，减少消费者迁移面；寻址、权限意图、
// provider 分派与实际写操作均已进入 Storage -> FileSystem -> File 主通路。
import type {
  Bookmark,
  BookmarkFolder,
  FileMeta,
  FilesPort,
  NewBookmark,
  Note,
  NoteMeta,
  StoredFile,
  Thread,
} from "@protocol/files"
import {
  NODE_KINDS,
  isNodeKind,
  type FsCreateInput,
  type FsWritePatch,
  type Node,
  type NodeKind,
  type NodeOfKind,
} from "@protocol/node"
import type { NewSubscription, SubscriptionType } from "@protocol/subscription"
import { fileRefKey, isFileRef, type FileRef } from "@protocol/file-system"
import { feedNodeId, feedNodeToSub } from "@/files/feed-node"
import { noteText } from "@/files/note-text"
import { buildParentOf, effectiveParentId } from "@/files/notes-tree-util"
import { bytesToBase64 } from "@/lib/base64"
import {
  corePlaceRef,
  resourceFileRef,
  resourceRefForFile,
} from "@/filesystem/resource-file-system"
import { fileSystemRegistry, type FileSystemRegistry } from "@/filesystem/registry"
import type { DirectoryPage, FileSystemAccessContext } from "@/filesystem/types"
import { FileSystemError } from "@/filesystem/types"

export type FileSystemFilesGateway = Pick<
  FileSystemRegistry,
  "stat" | "readDirectory" | "read" | "write" | "invoke"
> &
  Partial<Pick<FileSystemRegistry, "readMany">>

export type FileSystemFilesPortOptions = {
  /** 每次目录读取请求的最大条目数。 */
  directoryPageSize?: number
  /** provider 没有原生 batch 时的读取并发上限。 */
  readConcurrency?: number
}

const DEFAULT_DIRECTORY_PAGE_SIZE = 64
const DEFAULT_READ_CONCURRENCY = 4
const MAX_READ_CONCURRENCY = 32

const SYSTEM_PERMISSIONS = [
  "fs:read",
  "fs:write",
  "fs.notes:read",
  "fs.notes:write",
  "fs.blobs:read",
] as const

function access(intent: NonNullable<FileSystemAccessContext["intent"]>): FileSystemAccessContext {
  return { actor: "system", permissions: SYSTEM_PERMISSIONS, intent }
}

function nodeFileRef(kind: NodeKind, id: string): FileRef {
  return resourceFileRef({ scheme: "node", kind, id })
}

function nodeKindForFile(ref: FileRef): NodeKind | null {
  const resource = resourceRefForFile(ref)
  return resource?.scheme === "node" && isNodeKind(resource.kind) ? resource.kind : null
}

function isNode(value: unknown): value is Node {
  if (!value || typeof value !== "object") return false
  const node = value as Partial<Node>
  return typeof node.id === "string" && typeof node.kind === "string" && isNodeKind(node.kind)
}

function nodeToBookmark(node: NodeOfKind<"bookmark">): Bookmark {
  return {
    id: node.id,
    title: node.title,
    url: node.content.url,
    description: node.content.description,
    favicon: node.content.favicon,
    folderId: node.parentId,
    tags: node.tags,
    createdAt: node.createdAt,
  }
}

function nodeToFolder(node: NodeOfKind<"folder">): BookmarkFolder {
  return { id: node.id, name: node.title, createdAt: node.createdAt }
}

function nodeToFileMeta(node: NodeOfKind<"file">): FileMeta {
  return {
    id: node.id,
    name: node.title,
    type: node.blobRef.mime,
    size: node.blobRef.size,
    createdAt: node.createdAt,
    tags: node.tags,
  }
}

function nodeToNote(node: NodeOfKind<"note">): Note {
  const blockMeta = (node as NodeOfKind<"note"> & Pick<Note, "blockMeta">).blockMeta
  return {
    id: node.id,
    title: node.title,
    content: node.content,
    parentId: node.parentId,
    sortKey: node.sortKey,
    tags: node.tags,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    ...(blockMeta ? { blockMeta } : {}),
  }
}

function nodeToThread(node: NodeOfKind<"thread">): Thread {
  return {
    id: node.id,
    title: node.title,
    messages: node.content.messages,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  }
}

function resultRef(value: unknown): FileRef | null {
  if (!value || typeof value !== "object") return null
  const ref = (value as { ref?: unknown }).ref
  return isFileRef(ref) ? ref : null
}

function isNotFound(error: unknown): boolean {
  return error instanceof FileSystemError && error.code === "not-found"
}

function positiveIntegerOption(
  name: string,
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new FileSystemError(
      "invalid-input",
      `${name} must be an integer between 1 and ${maximum}`,
    )
  }
  return resolved
}

async function mapConcurrentOrdered<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  const failures: Array<{ index: number; error: unknown }> = []
  let nextIndex = 0
  let stopped = false
  const worker = async () => {
    while (!stopped) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      try {
        results[index] = await task(items[index] as T, index)
      } catch (error) {
        failures.push({ index, error })
        stopped = true
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  if (failures.length > 0) {
    failures.sort((left, right) => left.index - right.index)
    throw failures[0]?.error
  }
  return results
}

/**
 * 注入 gateway 便于边界测试；生产实例注入全局 FileSystemRegistry。
 * 该外观只依赖 registry 契约，不 import 任一具体 store。
 */
export function createFileSystemFilesPort(
  gateway: FileSystemFilesGateway = fileSystemRegistry,
  options: FileSystemFilesPortOptions = {},
): FilesPort {
  const directoryPageSize = positiveIntegerOption(
    "directoryPageSize",
    options.directoryPageSize,
    DEFAULT_DIRECTORY_PAGE_SIZE,
    10_000,
  )
  const readConcurrency = positiveIntegerOption(
    "readConcurrency",
    options.readConcurrency,
    DEFAULT_READ_CONCURRENCY,
    MAX_READ_CONCURRENCY,
  )

  async function* directoryPages(
    ref: FileRef,
    options: Pick<
      NonNullable<Parameters<FileSystemFilesGateway["readDirectory"]>[2]>,
      "recursive"
    > = {},
  ): AsyncGenerator<DirectoryPage["entries"]> {
    let cursor: string | undefined
    const seen = new Set<string>()
    do {
      const page = await gateway.readDirectory(ref, access("directory"), {
        ...(cursor ? { cursor } : {}),
        ...options,
        limit: directoryPageSize,
      })
      yield page.entries
      if (!page.nextCursor) return
      if (seen.has(page.nextCursor)) {
        throw new FileSystemError(
          "unavailable",
          `Directory cursor did not advance: ${page.nextCursor}`,
          ref,
        )
      }
      seen.add(page.nextCursor)
      cursor = page.nextCursor
    } while (cursor)
  }

  async function readNode(ref: FileRef): Promise<Node | undefined> {
    try {
      const result = await gateway.read(ref, access("content"), { encoding: "json" })
      return isNode(result.data) ? result.data : undefined
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }

  async function readNodes(refs: readonly FileRef[]): Promise<Array<Node | undefined>> {
    if (refs.length === 0) return []
    if (gateway.readMany) {
      const results = await gateway.readMany(refs, access("content"), {
        encoding: "json",
        concurrency: readConcurrency,
      })
      if (!Array.isArray(results) || results.length !== refs.length) {
        throw new FileSystemError(
          "unavailable",
          `FileSystem batch returned ${Array.isArray(results) ? results.length : "a non-array batch"} for ${refs.length} refs`,
          refs[0],
        )
      }
      for (let index = 0; index < results.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(results, index) || results[index] === undefined) {
          throw new FileSystemError(
            "unavailable",
            `FileSystem batch returned an undefined result at index ${index}`,
            refs[index],
          )
        }
      }
      return results.map((result) => (result && isNode(result.data) ? result.data : undefined))
    }
    return mapConcurrentOrdered(refs, readConcurrency, readNode)
  }

  async function statNode(kind: NodeKind, id: string): Promise<boolean> {
    return Boolean(await gateway.stat(nodeFileRef(kind, id), access("metadata")))
  }

  async function walkPlace(place: Parameters<typeof corePlaceRef>[0]): Promise<Node[]> {
    const root = corePlaceRef(place)
    const seen = new Set<string>()
    const nodes: Node[] = []
    // 逐页消费目录投影，每页走 provider batch 或有限并发 fallback；内存与并发均有界。
    for await (const entries of directoryPages(root, { recursive: true })) {
      const refs = entries.flatMap((item) => {
        if (!nodeKindForFile(item.target)) return []
        const key = fileRefKey(item.target)
        if (seen.has(key)) return []
        seen.add(key)
        return [item.target]
      })
      for (const node of await readNodes(refs)) {
        if (node) nodes.push(node)
      }
    }
    return nodes
  }

  async function listNodes(kinds: NodeKind[]): Promise<Node[]> {
    if (!kinds.length) return []
    const want = new Set(kinds)
    const places = new Set<Parameters<typeof corePlaceRef>[0]>()
    for (const kind of want) {
      if (kind === "folder" || kind === "bookmark") places.add("bookmarks")
      else if (kind === "note") places.add("notes")
      else if (kind === "file") places.add("files")
      else if (kind === "feed") places.add("subscriptions")
      else if (kind === "thread") places.add("home")
    }
    const seen = new Set<string>()
    const result: Node[] = []
    for (const place of places) {
      for (const node of await walkPlace(place)) {
        if (!want.has(node.kind) || seen.has(node.id)) continue
        seen.add(node.id)
        result.push(node)
      }
    }
    return result
  }

  async function findNode(id: string): Promise<Node | undefined> {
    for (const kind of NODE_KINDS) {
      const ref = nodeFileRef(kind, id)
      const file = await gateway.stat(ref, access("metadata"))
      if (file) return readNode(ref)
    }
    return undefined
  }

  async function createNodeAtPlace(
    place: Parameters<typeof corePlaceRef>[0],
    input: FsCreateInput | Record<string, unknown>,
  ): Promise<Node> {
    const value = await gateway.invoke(corePlaceRef(place), "create", input, access("action"))
    const ref = resultRef(value)
    if (!ref) throw new FileSystemError("unavailable", "FileSystem create did not return a FileRef")
    const node = await readNode(ref)
    if (!node) throw new FileSystemError("not-found", "Created file cannot be read", ref)
    return node
  }

  async function updateNode(
    kind: NodeKind,
    id: string,
    patch: FsWritePatch,
  ): Promise<Node | undefined> {
    const ref = nodeFileRef(kind, id)
    if (!(await gateway.stat(ref, access("metadata")))) return undefined
    await gateway.write(ref, { data: patch }, access("write"))
    return readNode(ref)
  }

  async function deleteNode(kind: NodeKind, id: string): Promise<void> {
    const ref = nodeFileRef(kind, id)
    if (!(await gateway.stat(ref, access("metadata")))) return
    await gateway.invoke(ref, "delete", undefined, access("action"))
  }

  async function listNotesWithEffectiveParents(): Promise<Note[]> {
    const notes = (await listNodes(["note"]))
      .filter((node): node is NodeOfKind<"note"> => node.kind === "note")
      .map(nodeToNote)
    const parentOf = buildParentOf(notes)
    return notes.map((note) => ({
      ...note,
      parentId: effectiveParentId(note.id, note.parentId, parentOf),
    }))
  }

  return {
    async listSubscriptions() {
      return (await listNodes(["feed"]))
        .filter((node): node is NodeOfKind<"feed"> => node.kind === "feed")
        .map(feedNodeToSub)
        .sort((a, b) => b.createdAt - a.createdAt)
    },
    async addSubscription(input: NewSubscription) {
      const key = input.key.trim()
      const existing = await readNode(nodeFileRef("feed", feedNodeId(input.type, key)))
      if (existing?.kind === "feed") return feedNodeToSub(existing)
      const node = await createNodeAtPlace("subscriptions", {
        kind: "feed",
        title: input.title,
        content: { ...input, key },
      })
      if (node.kind !== "feed") throw new FileSystemError("unavailable", "Expected feed file")
      return feedNodeToSub(node)
    },
    async removeSubscription(type: SubscriptionType, key: string) {
      await deleteNode("feed", feedNodeId(type, key.trim()))
    },
    async isSubscribed(type: SubscriptionType, key: string) {
      return statNode("feed", feedNodeId(type, key.trim()))
    },
    async listBookmarks() {
      return (await listNodes(["bookmark"]))
        .filter((node): node is NodeOfKind<"bookmark"> => node.kind === "bookmark")
        .map(nodeToBookmark)
        .sort((a, b) => b.createdAt - a.createdAt)
    },
    async addBookmark(input: NewBookmark) {
      const node = await createNodeAtPlace("bookmarks", {
        kind: "bookmark",
        title: input.title,
        tags: input.tags,
        parentId: input.folderId ?? null,
        content: {
          url: input.url,
          description: input.description,
          favicon: input.favicon,
        },
      })
      if (node.kind !== "bookmark") {
        throw new FileSystemError("unavailable", "Expected bookmark file")
      }
      return nodeToBookmark(node)
    },
    async updateBookmark(id, patch) {
      const content = {
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.favicon !== undefined ? { favicon: patch.favicon } : {}),
      }
      await updateNode("bookmark", id, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.folderId !== undefined ? { parentId: patch.folderId } : {}),
        ...(Object.keys(content).length ? { content } : {}),
      })
    },
    async deleteBookmark(id) {
      await deleteNode("bookmark", id)
    },
    async listFolders() {
      return (await listNodes(["folder"]))
        .filter((node): node is NodeOfKind<"folder"> => node.kind === "folder")
        .map(nodeToFolder)
        .sort((a, b) => a.createdAt - b.createdAt)
    },
    async addFolder(name) {
      const node = await createNodeAtPlace("bookmarks", { kind: "folder", title: name })
      if (node.kind !== "folder") throw new FileSystemError("unavailable", "Expected folder file")
      return nodeToFolder(node)
    },
    async listFiles() {
      return (await listNodes(["file"]))
        .filter((node): node is NodeOfKind<"file"> => node.kind === "file")
        .map(nodeToFileMeta)
        .sort((a, b) => b.createdAt - a.createdAt)
    },
    async updateFileMeta(id, patch: Partial<Pick<StoredFile, "name" | "tags">>) {
      await updateNode("file", id, {
        ...(patch.name !== undefined ? { title: patch.name } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      })
    },
    async listNotes() {
      const notes = await listNotesWithEffectiveParents()
      const parents = new Set(notes.map((note) => note.parentId).filter((id): id is string => !!id))
      return notes
        .map((note): NoteMeta => {
          const text = noteText(note.content)
          const { content: _content, ...meta } = note
          return {
            ...meta,
            excerpt: text.slice(0, 160),
            search: text,
            hasChildren: parents.has(note.id),
          }
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async getNote(id) {
      const node = await readNode(nodeFileRef("note", id))
      return node?.kind === "note" ? nodeToNote(node) : undefined
    },
    async listNoteChildren(parentId) {
      const directory = parentId ? nodeFileRef("note", parentId) : corePlaceRef("notes")
      const notes: NoteMeta[] = []
      const seen = new Set<string>()
      try {
        for await (const entries of directoryPages(directory)) {
          const noteEntries = entries.filter((entry) => {
            if (nodeKindForFile(entry.target) !== "note") return false
            const key = fileRefKey(entry.target)
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          const nodes = await readNodes(noteEntries.map((entry) => entry.target))
          noteEntries.forEach((entry, index) => {
            const node = nodes[index]
            if (!node || node.kind !== "note") return
            const note = { ...nodeToNote(node), parentId }
            const { content: _content, ...meta } = note
            notes.push({
              ...meta,
              excerpt: "",
              search: "",
              hasChildren:
                entry.file?.properties?.hasChildren === true ||
                entry.properties?.hasChildren === true,
            })
          })
        }
      } catch (error) {
        if (isNotFound(error)) return []
        throw error
      }
      return notes.sort((a, b) => {
        const byKey = a.sortKey.localeCompare(b.sortKey)
        return byKey || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
      })
    },
    async listThreads() {
      return (await listNodes(["thread"]))
        .filter((node): node is NodeOfKind<"thread"> => node.kind === "thread")
        .map(nodeToThread)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async getThread(id) {
      const node = await readNode(nodeFileRef("thread", id))
      return node?.kind === "thread" ? nodeToThread(node) : undefined
    },
    async createThread() {
      const node = await createNodeAtPlace("home", { kind: "thread" })
      if (node.kind !== "thread") throw new FileSystemError("unavailable", "Expected thread file")
      return nodeToThread(node)
    },
    async saveThread(thread) {
      await updateNode("thread", thread.id, {
        title: thread.title,
        content: { messages: thread.messages },
      })
    },
    async deleteThread(id) {
      await deleteNode("thread", id)
    },
    async renameThread(id, title) {
      await updateNode("thread", id, { title })
    },
    fsListNodes: listNodes,
    fsGetNode: findNode,
    async fsCreateNode(input) {
      if (input.kind === "file") {
        throw new Error("file 不可经 fs.create 创建 (需二进制上传)")
      }
      if (input.kind === "thread") throw new Error("thread 由 AI 会话自动创建, 不经 fs.create")
      const place =
        input.kind === "note" ? "notes" : input.kind === "feed" ? "subscriptions" : "bookmarks"
      return createNodeAtPlace(place, input)
    },
    fsUpdateNode: updateNode,
    async fsMoveNode(kind, id, parentId, afterSortKey) {
      const ref = nodeFileRef(kind, id)
      if (!(await gateway.stat(ref, access("metadata")))) return undefined
      await gateway.invoke(ref, "move", { parentId, afterSortKey }, access("action"))
      return readNode(ref)
    },
    fsDeleteNode: deleteNode,
    async fsReadBlob(id) {
      const ref = nodeFileRef("file", id)
      if (!(await gateway.stat(ref, access("metadata")))) return undefined
      const result = await gateway.read(ref, access("content"), { encoding: "binary" })
      const data = result.data
      if (data && typeof data === "object" && "base64" in data && typeof data.base64 === "string") {
        const value = data as { base64: string; mime?: unknown; size?: unknown }
        return {
          mime: typeof value.mime === "string" ? value.mime : result.mediaType,
          size: typeof value.size === "number" ? value.size : (result.size ?? 0),
          base64: value.base64,
        }
      }
      if (data instanceof Blob) {
        return {
          mime: data.type || result.mediaType,
          size: data.size,
          base64: bytesToBase64(new Uint8Array(await data.arrayBuffer())),
        }
      }
      throw new FileSystemError(
        "unavailable",
        "FileSystem returned an unsupported blob payload",
        ref,
      )
    },
  }
}

export const filesPort: FilesPort = createFileSystemFilesPort()
