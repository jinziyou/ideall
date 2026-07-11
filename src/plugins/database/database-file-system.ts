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
  FileReadOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchEvent,
  FileSystemWatchHandle,
} from "@/filesystem/types"
import { FileSystemError } from "@/filesystem/types"
import {
  addRow,
  createTable,
  deleteRow,
  deleteTable,
  exportDatabaseJson,
  importDatabaseJson,
  listRows,
  listTables,
  normalizeColumns,
  rowValuesForColumns,
  updateRow,
  type DataRow,
  type DataTable,
} from "./database-store"

export const DATABASE_FILE_SYSTEM_ID = "app.database"
export const DATABASE_ROOT_REF: FileRef = {
  fileSystemId: DATABASE_FILE_SYSTEM_ID,
  fileId: "root",
}

export const DATABASE_ACTIONS = {
  addRow: "add-row",
  createTable: "create-table",
  deleteRow: "delete-row",
  deleteTable: "delete",
  export: "export",
  import: "import",
  open: "open",
  updateRow: "update-row",
} as const

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
    capabilities: ["read", "delete", "actions", "watch", "standalone-window"],
    source: { kind: "app", id: "database", label: "数据库" },
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    version: String(table.updatedAt),
    properties: {
      tableId: table.id,
      columns: table.columns,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    },
  }
}

export type DatabaseFileSystemDeps = {
  addRow: typeof addRow
  createTable: typeof createTable
  deleteRow: typeof deleteRow
  deleteTable: typeof deleteTable
  exportDatabaseJson: typeof exportDatabaseJson
  importDatabaseJson: typeof importDatabaseJson
  listRows: typeof listRows
  listTables: typeof listTables
  normalizeColumns: typeof normalizeColumns
  rowValuesForColumns: typeof rowValuesForColumns
  updateRow: typeof updateRow
}

const defaultDeps: DatabaseFileSystemDeps = {
  addRow,
  createTable,
  deleteRow,
  deleteTable,
  exportDatabaseJson,
  importDatabaseJson,
  listRows,
  listTables,
  normalizeColumns,
  rowValuesForColumns,
  updateRow,
}

async function findTable(
  ref: FileRef,
  deps: DatabaseFileSystemDeps,
): Promise<DataTable | undefined> {
  const id = tableId(ref)
  return id ? (await deps.listTables()).find((item) => item.id === id) : undefined
}

async function requireTable(ref: FileRef, deps: DatabaseFileSystemDeps): Promise<DataTable> {
  const table = await findTable(ref, deps)
  if (!table) throw new FileSystemError("not-found", `Table not found: ${fileRefKey(ref)}`, ref)
  return table
}

function assertAccess(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  intent: "metadata" | "directory" | "content" | "write" | "action" | "watch",
  permission: "fs:read" | "fs:write",
  allowActiveEngine = true,
): void {
  if (ctx.actor === "ui") return
  if (
    allowActiveEngine &&
    ctx.actor === "engine" &&
    ctx.activeFile != null &&
    sameFileRef(ref, ctx.activeFile) &&
    ctx.intent === intent
  ) {
    return
  }
  if (ctx.intent === intent && ctx.permissions.includes(permission)) return
  throw new FileSystemError(
    "permission-denied",
    `The ${ctx.actor} actor requires ${permission} permission and ${intent} intent`,
    ref,
  )
}

function rangedJson(
  ref: FileRef,
  data: unknown,
  options?: FileReadOptions,
): { data: unknown; size?: number } {
  if (!options?.range) return { data }
  const { start, end } = options.range
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    (end != null && (!Number.isSafeInteger(end) || end < start))
  ) {
    throw new FileSystemError("invalid-input", "Invalid read range", ref)
  }
  const bytes = new TextEncoder().encode(JSON.stringify(data)).slice(start, end)
  return {
    data: options.encoding === "binary" ? bytes : new TextDecoder().decode(bytes),
    size: bytes.byteLength,
  }
}

function objectInput(ref: FileRef, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new FileSystemError("invalid-input", "Database action input must be an object", ref)
  }
  return input as Record<string, unknown>
}

function stringInput(ref: FileRef, input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== "string") {
    throw new FileSystemError("invalid-input", `Database action requires ${key}`, ref)
  }
  return value
}

function valuesInput(
  ref: FileRef,
  input: Record<string, unknown>,
): Record<string, string | undefined> {
  const raw = input.values
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new FileSystemError("invalid-input", "Database row values must be an object", ref)
  }
  const entries = Object.entries(raw)
  if (entries.some(([, value]) => value !== undefined && typeof value !== "string")) {
    throw new FileSystemError("invalid-input", "Database row values must be strings", ref)
  }
  return Object.fromEntries(entries) as Record<string, string | undefined>
}

function columnsInput(
  ref: FileRef,
  input: Record<string, unknown>,
  deps: DatabaseFileSystemDeps,
): string[] {
  const raw = input.columns
  if (typeof raw === "string") return deps.normalizeColumns(raw)
  if (Array.isArray(raw) && raw.every((column) => typeof column === "string")) {
    return deps.normalizeColumns(raw.join("\n"))
  }
  throw new FileSystemError("invalid-input", "Database table requires columns", ref)
}

async function requireRow(
  ref: FileRef,
  table: DataTable,
  rowId: string,
  deps: DatabaseFileSystemDeps,
): Promise<DataRow> {
  const row = (await deps.listRows(table.id)).find((item) => item.id === rowId)
  if (!row) throw new FileSystemError("not-found", `Row not found in table: ${rowId}`, ref)
  return row
}

function isMutationAction(action: string): boolean {
  return (
    action === DATABASE_ACTIONS.createTable ||
    action === DATABASE_ACTIONS.import ||
    action === DATABASE_ACTIONS.addRow ||
    action === DATABASE_ACTIONS.updateRow ||
    action === DATABASE_ACTIONS.deleteRow ||
    action === DATABASE_ACTIONS.deleteTable
  )
}

export function createDatabaseFileSystem(
  deps: DatabaseFileSystemDeps = defaultDeps,
): FileSystemProvider {
  const watchers = new Map<string, Set<(event: FileSystemWatchEvent) => void>>()
  const emitOne = (ref: FileRef, type: FileSystemWatchEvent["type"]) => {
    const event: FileSystemWatchEvent = { type, ref }
    for (const notify of watchers.get(fileRefKey(ref)) ?? []) notify(event)
  }
  const emitMutation = (ref: FileRef, type: FileSystemWatchEvent["type"] = "changed") => {
    emitOne(ref, type)
    if (!sameFileRef(ref, DATABASE_ROOT_REF)) emitOne(DATABASE_ROOT_REF, "changed")
  }
  return {
    descriptor: {
      fileSystemId: DATABASE_FILE_SYSTEM_ID,
      name: "数据库",
      root: DATABASE_ROOT_REF,
      source: { kind: "app", id: "database", label: "数据库" },
      capabilities: ["read-directory", "read", "create", "delete", "actions", "watch"],
    },
    async stat(ref, ctx) {
      assertAccess(ref, ctx, "metadata", "fs:read")
      if (sameFileRef(ref, DATABASE_ROOT_REF)) {
        return {
          ref,
          kind: "directory",
          name: "数据库",
          mediaType: DIRECTORY_MEDIA_TYPE,
          capabilities: ["read-directory", "read", "create", "actions", "watch"],
          source: this.descriptor.source,
        }
      }
      const table = await findTable(ref, deps)
      return table ? tableFile(table) : null
    },
    async readDirectory(ref, ctx): Promise<DirectoryPage> {
      assertAccess(ref, ctx, "directory", "fs:read")
      if (!sameFileRef(ref, DATABASE_ROOT_REF))
        throw new FileSystemError("unsupported", "Table is not a directory", ref)
      const tables = await deps.listTables()
      return {
        entries: tables.map((table, index) => ({
          entryId: table.id,
          parent: DATABASE_ROOT_REF,
          target: tableRef(table.id),
          name: table.name,
          kind: "child",
          sortKey: String(index).padStart(6, "0"),
          properties: tableFile(table).properties,
        })),
      }
    },
    async read(ref, ctx, options?: FileReadOptions): Promise<FileReadResult> {
      assertAccess(ref, ctx, "content", "fs:read")
      if (sameFileRef(ref, DATABASE_ROOT_REF)) {
        const tables = await deps.listTables()
        const ranged = rangedJson(ref, { tables }, options)
        return {
          data: ranged.data,
          mediaType: "application/vnd.ideall.database.workspace+json",
          size: ranged.size,
          version: tables.length
            ? String(Math.max(...tables.map((table) => table.updatedAt)))
            : undefined,
        }
      }
      const table = await requireTable(ref, deps)
      const rows = await deps.listRows(table.id)
      const ranged = rangedJson(ref, { table, rows }, options)
      return {
        data: ranged.data,
        mediaType: "application/vnd.ideall.database+json",
        size: ranged.size,
        version: String(Math.max(table.updatedAt, ...rows.map((row) => row.updatedAt))),
      }
    },
    async write(ref, _input, ctx) {
      assertAccess(ref, ctx, "write", "fs:write")
      throw new FileSystemError("unsupported", "Use database engine operations to edit tables", ref)
    },
    async actions(ref, ctx): Promise<FileAction[]> {
      assertAccess(ref, ctx, "action", "fs:read")
      if (sameFileRef(ref, DATABASE_ROOT_REF)) {
        return [
          { id: DATABASE_ACTIONS.open, label: "打开" },
          { id: DATABASE_ACTIONS.createTable, label: "新建表", requires: ["create"] },
          { id: DATABASE_ACTIONS.import, label: "导入", requires: ["create"] },
          { id: DATABASE_ACTIONS.export, label: "导出" },
        ]
      }
      await requireTable(ref, deps)
      return [
        { id: DATABASE_ACTIONS.open, label: "打开" },
        { id: DATABASE_ACTIONS.addRow, label: "新增行" },
        { id: DATABASE_ACTIONS.updateRow, label: "更新行" },
        { id: DATABASE_ACTIONS.deleteRow, label: "删除行", destructive: true },
        { id: DATABASE_ACTIONS.export, label: "导出" },
        {
          id: DATABASE_ACTIONS.deleteTable,
          label: "删除表",
          destructive: true,
          requires: ["delete"],
        },
      ]
    },
    async invoke(ref, action, input, ctx) {
      const mutation = isMutationAction(action)
      assertAccess(ref, ctx, "action", mutation ? "fs:write" : "fs:read", !mutation)
      if (action === DATABASE_ACTIONS.open) return { ref }
      if (sameFileRef(ref, DATABASE_ROOT_REF)) {
        if (action === DATABASE_ACTIONS.createTable) {
          const raw = objectInput(ref, input)
          const table = await deps.createTable(
            stringInput(ref, raw, "name"),
            columnsInput(ref, raw, deps),
          )
          const createdRef = tableRef(table.id)
          emitMutation(createdRef, "created")
          return { ref: createdRef, table }
        }
        if (action === DATABASE_ACTIONS.import) {
          const raw = objectInput(ref, input)
          const result = await deps.importDatabaseJson(stringInput(ref, raw, "content"))
          emitMutation(DATABASE_ROOT_REF)
          return result
        }
        if (action === DATABASE_ACTIONS.export) return deps.exportDatabaseJson()
        throw new FileSystemError("unsupported", `Unsupported database action: ${action}`, ref)
      }

      const table = await requireTable(ref, deps)
      if (action === DATABASE_ACTIONS.addRow) {
        const raw = objectInput(ref, input)
        const row = await deps.addRow(
          table.id,
          deps.rowValuesForColumns(table.columns, valuesInput(ref, raw)),
        )
        emitMutation(ref)
        return row
      }
      if (action === DATABASE_ACTIONS.updateRow) {
        const raw = objectInput(ref, input)
        const id = stringInput(ref, raw, "id")
        await requireRow(ref, table, id, deps)
        const row = await deps.updateRow(
          id,
          table.id,
          deps.rowValuesForColumns(table.columns, valuesInput(ref, raw)),
        )
        emitMutation(ref)
        return row
      }
      if (action === DATABASE_ACTIONS.deleteRow) {
        const raw = objectInput(ref, input)
        const id = stringInput(ref, raw, "id")
        await requireRow(ref, table, id, deps)
        await deps.deleteRow(id)
        emitMutation(ref)
        return { ref, rowId: id, deleted: true }
      }
      if (action === DATABASE_ACTIONS.export) {
        return JSON.stringify({ table, rows: await deps.listRows(table.id) }, null, 2)
      }
      if (action === DATABASE_ACTIONS.deleteTable) {
        await deps.deleteTable(table.id)
        emitMutation(ref, "deleted")
        return { ref, deleted: true }
      }
      throw new FileSystemError("unsupported", `Unsupported database action: ${action}`, ref)
    },
    watch(ref, ctx, notify): FileSystemWatchHandle {
      assertAccess(ref, ctx, "watch", "fs:read")
      const key = fileRefKey(ref)
      const listeners = watchers.get(key) ?? new Set<(event: FileSystemWatchEvent) => void>()
      listeners.add(notify)
      watchers.set(key, listeners)
      return {
        dispose() {
          listeners.delete(notify)
          if (listeners.size === 0) watchers.delete(key)
        },
      }
    },
  }
}

export const databaseFileSystem = createDatabaseFileSystem()

let mounted = false

export function registerDatabaseFileSystem(mount: (provider: FileSystemProvider) => void): void {
  if (mounted) return
  mount(databaseFileSystem)
  mounted = true
}
