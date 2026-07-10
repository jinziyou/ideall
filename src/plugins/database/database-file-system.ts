import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  sameFileRef,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type {
  DirectoryPage,
  FileAction,
  FileReadResult,
  FileSystemProvider,
} from "@/filesystem/types"
import { FileSystemError } from "@/filesystem/types"
import { deleteTable, listRows, listTables, type DataTable } from "./database-store"

export const DATABASE_FILE_SYSTEM_ID = "app.database"
const ROOT_REF: FileRef = { fileSystemId: DATABASE_FILE_SYSTEM_ID, fileId: "root" }

function tableRef(id: string): FileRef {
  return { fileSystemId: DATABASE_FILE_SYSTEM_ID, fileId: `table:${encodeURIComponent(id)}` }
}

function tableId(ref: FileRef): string | null {
  if (ref.fileSystemId !== DATABASE_FILE_SYSTEM_ID || !ref.fileId.startsWith("table:")) return null
  try {
    return decodeURIComponent(ref.fileId.slice("table:".length)) || null
  } catch {
    return null
  }
}

function tableFile(table: DataTable): IdeallFile {
  return {
    ref: tableRef(table.id),
    kind: "file",
    name: table.name,
    mediaType: "application/vnd.ideall.database+json",
    capabilities: ["read", "delete", "actions"],
    source: { kind: "app", id: "database", label: "数据库" },
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    properties: { tableId: table.id, columns: table.columns.length },
  }
}

async function requireTable(ref: FileRef): Promise<DataTable> {
  const id = tableId(ref)
  const table = id ? (await listTables()).find((item) => item.id === id) : undefined
  if (!table) throw new FileSystemError("not-found", `Table not found: ${fileRefKey(ref)}`, ref)
  return table
}

export const databaseFileSystem: FileSystemProvider = {
  descriptor: {
    fileSystemId: DATABASE_FILE_SYSTEM_ID,
    name: "数据库",
    root: ROOT_REF,
    source: { kind: "app", id: "database", label: "数据库" },
    capabilities: ["read-directory", "read", "delete", "actions"],
  },
  async stat(ref) {
    if (sameFileRef(ref, ROOT_REF)) {
      return {
        ref,
        kind: "directory",
        name: "数据库",
        mediaType: DIRECTORY_MEDIA_TYPE,
        capabilities: ["read-directory", "actions"],
        source: this.descriptor.source,
      }
    }
    return tableFile(await requireTable(ref))
  },
  async readDirectory(ref): Promise<DirectoryPage> {
    if (!sameFileRef(ref, ROOT_REF))
      throw new FileSystemError("unsupported", "Table is not a directory", ref)
    const tables = await listTables()
    return {
      entries: tables.map((table, index) => ({
        entryId: table.id,
        parent: ROOT_REF,
        target: tableRef(table.id),
        name: table.name,
        kind: "child",
        sortKey: String(index).padStart(6, "0"),
      })),
    }
  },
  async read(ref): Promise<FileReadResult> {
    const table = await requireTable(ref)
    const rows = await listRows(table.id)
    return {
      data: { table, rows },
      mediaType: "application/vnd.ideall.database+json",
      version: String(Math.max(table.updatedAt, ...rows.map((row) => row.updatedAt))),
    }
  },
  async write(ref) {
    throw new FileSystemError("unsupported", "Use database engine operations to edit tables", ref)
  },
  async actions(ref): Promise<FileAction[]> {
    if (sameFileRef(ref, ROOT_REF)) return [{ id: "open", label: "打开" }]
    await requireTable(ref)
    return [
      { id: "open", label: "打开" },
      { id: "delete", label: "删除表", destructive: true, requires: ["delete"] },
    ]
  },
  async invoke(ref, action) {
    if (action === "open") return { ref }
    if (action === "delete") {
      const table = await requireTable(ref)
      await deleteTable(table.id)
      return { ref, deleted: true }
    }
    throw new FileSystemError("unsupported", `Unsupported database action: ${action}`, ref)
  },
}

let mounted = false

export function registerDatabaseFileSystem(mount: (provider: FileSystemProvider) => void): void {
  if (mounted) return
  mount(databaseFileSystem)
  mounted = true
}
