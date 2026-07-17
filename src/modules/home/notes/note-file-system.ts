import { isFileRef, sameFileRef, type DirectoryEntry, type IdeallFile } from "@protocol/file-system"
import type { NewNote, NoteMeta } from "@protocol/files"
import type { NodeOfKind } from "@protocol/node"
import { invokeFileAction, readFile } from "@/filesystem/registry"
import { walkFileDirectory } from "@/filesystem/directory-walk"
import {
  corePlaceRef,
  resourceFileRef,
  resourceRefForFile,
} from "@/filesystem/resource-file-system"
import { noteText } from "@/files/note-text"

const DIRECTORY_CONTEXT = { actor: "ui", permissions: [], intent: "directory" } as const
const CONTENT_CONTEXT = { actor: "ui", permissions: [], intent: "content" } as const
const ACTION_CONTEXT = { actor: "ui", permissions: [], intent: "action" } as const

export type FileNote = NoteMeta & { version: string | null }

function noteEntry(entry: DirectoryEntry): boolean {
  const resource = resourceRefForFile(entry.target)
  return resource?.scheme === "node" && resource.kind === "note"
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : []
}

async function allNoteEntries(): Promise<DirectoryEntry[]> {
  return (
    await walkFileDirectory(
      corePlaceRef("notes"),
      DIRECTORY_CONTEXT,
      (entry) => noteEntry(entry) && entry.properties?.hasChildren === true,
    )
  ).filter(noteEntry)
}

/** 通过目录投影枚举笔记；搜索视图按需读取正文，侧栏只读元数据。 */
export async function listNoteFiles(includeText = false): Promise<FileNote[]> {
  const entries = await allNoteEntries()
  return Promise.all(
    entries.map(async (entry) => {
      const properties = entry.properties
      let text = ""
      let version =
        entry.file && sameFileRef(entry.file.ref, entry.target) ? entry.file.version : undefined
      if (includeText) {
        const read = await readFile(entry.target, CONTENT_CONTEXT, { encoding: "json" })
        version = read.version ?? version
        const node = read.data as Partial<NodeOfKind<"note">> | null
        if (node?.kind === "note" && Array.isArray(node.content)) text = noteText(node.content)
      }
      return {
        id: resourceRefForFile(entry.target)?.id ?? entry.target.fileId,
        title: entry.name,
        parentId: typeof properties?.parentId === "string" ? properties.parentId : null,
        sortKey: typeof entry.sortKey === "string" ? entry.sortKey : "",
        tags: stringArray(properties?.tags),
        createdAt: typeof properties?.createdAt === "number" ? properties.createdAt : 0,
        updatedAt: typeof properties?.updatedAt === "number" ? properties.updatedAt : 0,
        excerpt: text.slice(0, 160),
        search: text,
        hasChildren: properties?.hasChildren === true,
        version: version ?? null,
      }
    }),
  )
}

function createdFile(value: unknown): IdeallFile {
  if (!value || typeof value !== "object" || !("file" in value)) {
    throw new Error("文件系统未返回新建页面")
  }
  const file = value.file as Partial<IdeallFile> | null
  if (!file || !isFileRef(file.ref) || typeof file.name !== "string") {
    throw new Error("文件系统返回了无效笔记")
  }
  return file as IdeallFile
}

export type CreateNoteFileInput = Pick<NewNote, "title" | "content" | "tags">

export async function createNoteFile(
  parentId: string | null,
  input: CreateNoteFileInput = {},
): Promise<IdeallFile> {
  const parent = parentId
    ? resourceFileRef({ scheme: "node", kind: "note", id: parentId })
    : corePlaceRef("notes")
  return createdFile(await invokeFileAction(parent, "create", input, ACTION_CONTEXT))
}

export function updateNoteFileTags(
  note: Pick<FileNote, "id" | "version">,
  tags: string[],
): Promise<unknown> {
  return invokeFileAction(
    resourceFileRef({ scheme: "node", kind: "note", id: note.id }),
    "edit",
    { tags },
    ACTION_CONTEXT,
    { expectedVersion: note.version },
  )
}

export function moveNoteFile(
  note: Pick<FileNote, "id" | "version">,
  parentId: string | null,
  afterSortKey?: string | null,
): Promise<unknown> {
  return invokeFileAction(
    resourceFileRef({ scheme: "node", kind: "note", id: note.id }),
    "move",
    { parentId, ...(afterSortKey === undefined ? {} : { afterSortKey }) },
    ACTION_CONTEXT,
    { expectedVersion: note.version },
  )
}

export function deleteNoteFile(note: Pick<FileNote, "id" | "version">): Promise<unknown> {
  return invokeFileAction(
    resourceFileRef({ scheme: "node", kind: "note", id: note.id }),
    "delete",
    undefined,
    ACTION_CONTEXT,
    { expectedVersion: note.version },
  )
}

export function restoreNoteFile(id: string): Promise<unknown> {
  return invokeFileAction(
    resourceFileRef({ scheme: "node", kind: "note", id }),
    "restore",
    undefined,
    ACTION_CONTEXT,
  )
}
