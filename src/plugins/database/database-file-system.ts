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
import { FileSystemWatchEventHub } from "@/filesystem/watch-set"
import { paginateDirectoryItems } from "@/filesystem/provider-input"
import {
  DATABASE_FILE_SYSTEM_ID as BUILTIN_DATABASE_FILE_SYSTEM_ID,
  DATABASE_ROOT_REF as BUILTIN_DATABASE_ROOT_REF,
} from "@/filesystem/builtin-app-roots"
import {
  addRow,
  createTable,
  deleteRow,
  deleteTable,
  exportDatabaseJson,
  getRow,
  getTable,
  importDatabaseJson,
  listRows,
  listTables,
  normalizeColumns,
  rowValuesForColumns,
  updateRow,
  type DataRow,
  type DataTable,
} from "./database-store"

export const DATABASE_FILE_SYSTEM_ID = BUILTIN_DATABASE_FILE_SYSTEM_ID
export const DATABASE_ROOT_REF: FileRef = BUILTIN_DATABASE_ROOT_REF

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

export function databaseTableRef(id: string): FileRef {
  return { fileSystemId: DATABASE_FILE_SYSTEM_ID, fileId: `table:${encodeURIComponent(id)}` }
}

export function databaseRowsDirectoryRef(tableId: string): FileRef {
  return { fileSystemId: DATABASE_FILE_SYSTEM_ID, fileId: `rows:${encodeURIComponent(tableId)}` }
}

export function databaseRowRef(tableId: string, rowId: string): FileRef {
  return {
    fileSystemId: DATABASE_FILE_SYSTEM_ID,
    fileId: `row:${encodeURIComponent(tableId)}:${encodeURIComponent(rowId)}`,
  }
}

function tableId(ref: FileRef): string | null {
  if (ref.fileSystemId !== DATABASE_FILE_SYSTEM_ID || !ref.fileId.startsWith("table:")) return null
  try {
    return decodeURIComponent(ref.fileId.slice("table:".length)) || null
  } catch {
    return null
  }
}

function rowsDirectoryTableId(ref: FileRef): string | null {
  if (ref.fileSystemId !== DATABASE_FILE_SYSTEM_ID || !ref.fileId.startsWith("rows:")) return null
  try {
    return decodeURIComponent(ref.fileId.slice("rows:".length)) || null
  } catch {
    return null
  }
}

function rowIdentity(ref: FileRef): { tableId: string; rowId: string } | null {
  if (ref.fileSystemId !== DATABASE_FILE_SYSTEM_ID || !ref.fileId.startsWith("row:")) return null
  const encoded = ref.fileId.slice("row:".length)
  const delimiter = encoded.indexOf(":")
  if (delimiter <= 0 || delimiter === encoded.length - 1) return null
  try {
    const tableId = decodeURIComponent(encoded.slice(0, delimiter))
    const rowId = decodeURIComponent(encoded.slice(delimiter + 1))
    return tableId && rowId ? { tableId, rowId } : null
  } catch {
    return null
  }
}

function tableFile(table: DataTable): IdeallFile {
  return {
    ref: databaseTableRef(table.id),
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

function rowsDirectoryFile(table: DataTable): IdeallFile {
  return {
    ref: databaseRowsDirectoryRef(table.id),
    kind: "directory",
    name: `${table.name} · 行`,
    mediaType: DIRECTORY_MEDIA_TYPE,
    capabilities: ["read-directory", "read", "create", "actions", "watch"],
    source: { kind: "app", id: "database", label: "数据库" },
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    version: String(table.updatedAt),
    properties: {
      tableId: table.id,
      tableRef: databaseTableRef(table.id),
      projection: "database-rows",
    },
  }
}

function rowFile(row: DataRow, table: DataTable): IdeallFile {
  return {
    ref: databaseRowRef(table.id, row.id),
    kind: "file",
    // 行值属于正文，只能经 read(rowRef) 获取；名称/metadata 不投影任意单元格内容。
    name: `行 ${row.id}`,
    mediaType: "application/vnd.ideall.database.row+json",
    capabilities: ["read", "delete", "actions", "watch"],
    source: { kind: "app", id: "database", label: "数据库" },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: String(row.updatedAt),
    properties: {
      tableId: table.id,
      rowId: row.id,
      tableRef: databaseTableRef(table.id),
    },
  }
}

export type DatabaseFileSystemDeps = {
  addRow: typeof addRow
  createTable: typeof createTable
  deleteRow: typeof deleteRow
  deleteTable: typeof deleteTable
  exportDatabaseJson: typeof exportDatabaseJson
  getRow: (tableId: string, rowId: string) => Promise<DataRow | undefined>
  getTable: typeof getTable
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
  getRow: async (tableId, rowId) => {
    const row = await getRow(rowId)
    return row?.tableId === tableId ? row : undefined
  },
  getTable,
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
  return id ? deps.getTable(id) : undefined
}

async function findTableById(
  id: string | null,
  deps: DatabaseFileSystemDeps,
): Promise<DataTable | undefined> {
  return id ? deps.getTable(id) : undefined
}

async function requireTable(ref: FileRef, deps: DatabaseFileSystemDeps): Promise<DataTable> {
  const table = await findTable(ref, deps)
  if (!table) throw new FileSystemError("not-found", `Table not found: ${fileRefKey(ref)}`, ref)
  return table
}

async function requireRowsDirectory(
  ref: FileRef,
  deps: DatabaseFileSystemDeps,
): Promise<DataTable> {
  const table = await findTableById(rowsDirectoryTableId(ref), deps)
  if (!table) {
    throw new FileSystemError("not-found", `Rows directory not found: ${fileRefKey(ref)}`, ref)
  }
  return table
}

async function findRow(
  ref: FileRef,
  deps: DatabaseFileSystemDeps,
): Promise<{ table: DataTable; row: DataRow } | undefined> {
  const identity = rowIdentity(ref)
  if (!identity) return undefined
  const [table, row] = await Promise.all([
    deps.getTable(identity.tableId),
    deps.getRow(identity.tableId, identity.rowId),
  ])
  return table && row ? { table, row } : undefined
}

async function requireRowFile(
  ref: FileRef,
  deps: DatabaseFileSystemDeps,
): Promise<{ table: DataTable; row: DataRow }> {
  const value = await findRow(ref, deps)
  if (!value) throw new FileSystemError("not-found", `Row not found: ${fileRefKey(ref)}`, ref)
  return value
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
  const row = await deps.getRow(table.id, rowId)
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
  const watchEvents = new FileSystemWatchEventHub()
  const emitOne = (ref: FileRef, type: FileSystemWatchEvent["type"], version?: string) => {
    const table = tableId(ref)
    const rowsTable = rowsDirectoryTableId(ref)
    const row = rowIdentity(ref)
    const parent = row
      ? databaseRowsDirectoryRef(row.tableId)
      : table || rowsTable
        ? DATABASE_ROOT_REF
        : undefined
    const entryId = row
      ? row.rowId
      : table
        ? `table:${table}`
        : rowsTable
          ? `rows:${rowsTable}`
          : undefined
    watchEvents.emit({
      type,
      ref,
      ...(entryId ? { entryId } : {}),
      ...(parent ? (type === "deleted" ? { oldParent: parent } : { newParent: parent }) : {}),
      ...(version ? { version } : {}),
    })
  }
  const emitMutation = (ref: FileRef, type: FileSystemWatchEvent["type"] = "changed") => {
    emitOne(ref, type)
  }
  const emitTableMutation = (
    table: DataTable,
    row?: { ref: FileRef; type: FileSystemWatchEvent["type"]; version?: string },
  ) => {
    watchEvents.batch(() => {
      if (row) emitOne(row.ref, row.type, row.version)
      emitOne(databaseTableRef(table.id), "changed")
    })
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
          mediaType: "application/vnd.ideall.database.workspace+json",
          capabilities: ["read-directory", "read", "create", "actions", "watch"],
          source: this.descriptor.source,
        }
      }
      const table = await findTable(ref, deps)
      if (table) return tableFile(table)
      const rowsTable = await findTableById(rowsDirectoryTableId(ref), deps)
      if (rowsTable) return rowsDirectoryFile(rowsTable)
      const row = await findRow(ref, deps)
      return row ? rowFile(row.row, row.table) : null
    },
    async readDirectory(ref, ctx, options = {}): Promise<DirectoryPage> {
      assertAccess(ref, ctx, "directory", "fs:read")
      if (sameFileRef(ref, DATABASE_ROOT_REF)) {
        const tables = await deps.listTables()
        const rootEntries = tables.flatMap((table, index) => {
          const tableSnapshot = tableFile(table)
          const rowsSnapshot = rowsDirectoryFile(table)
          return [
            {
              entryId: `table:${table.id}`,
              parent: DATABASE_ROOT_REF,
              target: tableSnapshot.ref,
              name: tableSnapshot.name,
              kind: "child" as const,
              sortKey: String(index * 2).padStart(6, "0"),
              file: tableSnapshot,
              properties: tableSnapshot.properties,
            },
            {
              entryId: `rows:${table.id}`,
              parent: DATABASE_ROOT_REF,
              target: rowsSnapshot.ref,
              name: rowsSnapshot.name,
              kind: "child" as const,
              sortKey: String(index * 2 + 1).padStart(6, "0"),
              file: rowsSnapshot,
              properties: rowsSnapshot.properties,
            },
          ]
        })
        const result = paginateDirectoryItems(ref, rootEntries, options)
        return {
          entries: result.items,
          nextCursor: result.nextCursor,
        }
      }
      const table = await requireRowsDirectory(ref, deps)
      const rows = await deps.listRows(table.id)
      const result = paginateDirectoryItems(ref, rows, options)
      return {
        entries: result.items.map((row, index) => {
          const snapshot = rowFile(row, table)
          return {
            entryId: row.id,
            parent: ref,
            target: snapshot.ref,
            name: snapshot.name,
            kind: "child",
            sortKey: String(result.offset + index).padStart(6, "0"),
            file: snapshot,
            properties: snapshot.properties,
          }
        }),
        nextCursor: result.nextCursor,
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
      const rowsTable = await findTableById(rowsDirectoryTableId(ref), deps)
      if (rowsTable) {
        const rows = await deps.listRows(rowsTable.id)
        const ranged = rangedJson(ref, { table: rowsTable, rows }, options)
        return {
          data: ranged.data,
          mediaType: DIRECTORY_MEDIA_TYPE,
          size: ranged.size,
          version: String(Math.max(rowsTable.updatedAt, ...rows.map((row) => row.updatedAt))),
        }
      }
      const rowValue = await findRow(ref, deps)
      if (rowValue) {
        const ranged = rangedJson(ref, rowValue.row, options)
        return {
          data: ranged.data,
          mediaType: "application/vnd.ideall.database.row+json",
          size: ranged.size,
          version: String(rowValue.row.updatedAt),
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
      const exportAction = {
        id: DATABASE_ACTIONS.export,
        label: "导出",
        kind: "invoke" as const,
        output: { type: "string" as const, mediaType: "application/json" },
        idempotent: true,
      }
      const rowValuesAction = (
        table: DataTable,
        id: typeof DATABASE_ACTIONS.addRow | typeof DATABASE_ACTIONS.updateRow,
      ) => ({
        id,
        label: id === DATABASE_ACTIONS.addRow ? "新增行" : "更新行",
        kind: "invoke" as const,
        idempotent: false,
        input: {
          type: "object" as const,
          properties: {
            values: {
              type: "object" as const,
              title: "字段值",
              properties: Object.fromEntries(
                table.columns.map((column) => [column, { type: "string" as const, title: column }]),
              ),
              additionalProperties: false,
            },
          },
          required: ["values"],
          additionalProperties: false,
        },
      })
      if (sameFileRef(ref, DATABASE_ROOT_REF)) {
        return [
          { id: DATABASE_ACTIONS.open, label: "打开", kind: "display" },
          {
            id: DATABASE_ACTIONS.createTable,
            label: "新建表",
            kind: "invoke",
            idempotent: false,
            requires: ["create"],
            input: {
              type: "object",
              properties: {
                name: { type: "string", title: "表名", minLength: 1 },
                columns: {
                  type: "string",
                  title: "字段",
                  description: "使用逗号或换行分隔字段。",
                  format: "multiline",
                  minLength: 1,
                },
              },
              required: ["name", "columns"],
              additionalProperties: false,
            },
          },
          {
            id: DATABASE_ACTIONS.import,
            label: "导入",
            kind: "invoke",
            risk: "caution",
            idempotent: false,
            requires: ["create"],
            input: {
              type: "object",
              properties: {
                content: {
                  type: "string",
                  title: "数据库 JSON",
                  format: "multiline",
                  minLength: 2,
                },
              },
              required: ["content"],
              additionalProperties: false,
            },
            uiHints: { confirmDescription: "导入会合并并更新本地数据库。" },
          },
          exportAction,
        ]
      }
      const rowsTable = await findTableById(rowsDirectoryTableId(ref), deps)
      if (rowsTable) {
        return [
          { id: DATABASE_ACTIONS.open, label: "打开", kind: "display" },
          rowValuesAction(rowsTable, DATABASE_ACTIONS.addRow),
          exportAction,
        ]
      }
      const row = await findRow(ref, deps)
      if (row) {
        return [
          { id: DATABASE_ACTIONS.open, label: "打开", kind: "display" },
          rowValuesAction(row.table, DATABASE_ACTIONS.updateRow),
          {
            id: DATABASE_ACTIONS.deleteRow,
            label: "删除行",
            kind: "invoke",
            risk: "destructive",
            idempotent: true,
          },
          exportAction,
        ]
      }
      const table = await requireTable(ref, deps)
      return [
        { id: DATABASE_ACTIONS.open, label: "打开", kind: "display" },
        rowValuesAction(table, DATABASE_ACTIONS.addRow),
        {
          ...rowValuesAction(table, DATABASE_ACTIONS.updateRow),
          input: {
            type: "object",
            properties: {
              id: { type: "string", title: "行 ID", minLength: 1 },
              values: rowValuesAction(table, DATABASE_ACTIONS.updateRow).input.properties.values,
            },
            required: ["id", "values"],
            additionalProperties: false,
          },
        },
        {
          id: DATABASE_ACTIONS.deleteRow,
          label: "删除行",
          kind: "invoke",
          risk: "destructive",
          idempotent: true,
          input: {
            type: "object",
            properties: { id: { type: "string", title: "行 ID", minLength: 1 } },
            required: ["id"],
            additionalProperties: false,
          },
        },
        exportAction,
        {
          id: DATABASE_ACTIONS.deleteTable,
          label: "删除表",
          kind: "invoke",
          risk: "destructive",
          idempotent: true,
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
          const createdRef = databaseTableRef(table.id)
          watchEvents.batch(() => {
            emitOne(createdRef, "created", String(table.updatedAt))
            emitOne(databaseRowsDirectoryRef(table.id), "created", String(table.updatedAt))
          })
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

      const rowsTable = await findTableById(rowsDirectoryTableId(ref), deps)
      if (rowsTable) {
        if (action === DATABASE_ACTIONS.addRow) {
          const raw = objectInput(ref, input)
          const row = await deps.addRow(
            rowsTable.id,
            deps.rowValuesForColumns(rowsTable.columns, valuesInput(ref, raw)),
          )
          const createdRef = databaseRowRef(rowsTable.id, row.id)
          emitTableMutation(rowsTable, {
            ref: createdRef,
            type: "created",
            version: String(row.updatedAt),
          })
          return { ref: createdRef, row }
        }
        if (action === DATABASE_ACTIONS.export) {
          return JSON.stringify(
            { table: rowsTable, rows: await deps.listRows(rowsTable.id) },
            null,
            2,
          )
        }
        throw new FileSystemError("unsupported", `Unsupported database action: ${action}`, ref)
      }

      const rowValue = await findRow(ref, deps)
      if (rowValue) {
        if (action === DATABASE_ACTIONS.updateRow) {
          const raw = objectInput(ref, input)
          const row = await deps.updateRow(
            rowValue.row.id,
            rowValue.table.id,
            deps.rowValuesForColumns(rowValue.table.columns, valuesInput(ref, raw)),
          )
          emitTableMutation(rowValue.table, {
            ref,
            type: "changed",
            version: String(row.updatedAt),
          })
          return { ref, row }
        }
        if (action === DATABASE_ACTIONS.deleteRow) {
          await deps.deleteRow(rowValue.row.id)
          emitTableMutation(rowValue.table, { ref, type: "deleted" })
          return { ref, deleted: true }
        }
        if (action === DATABASE_ACTIONS.export) return JSON.stringify(rowValue.row, null, 2)
        throw new FileSystemError("unsupported", `Unsupported database action: ${action}`, ref)
      }

      const table = await requireTable(ref, deps)
      if (action === DATABASE_ACTIONS.addRow) {
        const raw = objectInput(ref, input)
        const row = await deps.addRow(
          table.id,
          deps.rowValuesForColumns(table.columns, valuesInput(ref, raw)),
        )
        const createdRef = databaseRowRef(table.id, row.id)
        emitTableMutation(table, {
          ref: createdRef,
          type: "created",
          version: String(row.updatedAt),
        })
        return { ref: createdRef, row }
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
        emitTableMutation(table, {
          ref: databaseRowRef(table.id, row.id),
          type: "changed",
          version: String(row.updatedAt),
        })
        return { ref: databaseRowRef(table.id, row.id), row }
      }
      if (action === DATABASE_ACTIONS.deleteRow) {
        const raw = objectInput(ref, input)
        const id = stringInput(ref, raw, "id")
        await requireRow(ref, table, id, deps)
        await deps.deleteRow(id)
        const deletedRef = databaseRowRef(table.id, id)
        emitTableMutation(table, { ref: deletedRef, type: "deleted" })
        return { ref: deletedRef, rowId: id, deleted: true }
      }
      if (action === DATABASE_ACTIONS.export) {
        return JSON.stringify({ table, rows: await deps.listRows(table.id) }, null, 2)
      }
      if (action === DATABASE_ACTIONS.deleteTable) {
        // 删除表会级联删除行；先取稳定行身份，让已打开的行文件收到 deleted，
        // 而不是只让目录消失后永远停留在旧 metadata。
        const rows = await deps.listRows(table.id)
        await deps.deleteTable(table.id)
        watchEvents.batch(() => {
          for (const row of rows) emitOne(databaseRowRef(table.id, row.id), "deleted")
          emitOne(ref, "deleted")
          emitOne(databaseRowsDirectoryRef(table.id), "deleted")
        })
        return { ref, deleted: true }
      }
      throw new FileSystemError("unsupported", `Unsupported database action: ${action}`, ref)
    },
    watch(ref, ctx, notify): FileSystemWatchHandle {
      assertAccess(ref, ctx, "watch", "fs:read")
      return watchEvents.watch(ref, notify)
    },
  }
}

export const databaseFileSystem = createDatabaseFileSystem()

let mounted: (() => void) | null = null

export function registerDatabaseFileSystem(
  mount: (provider: FileSystemProvider) => () => void,
): () => void {
  if (mounted) return () => {}
  const dispose = mount(databaseFileSystem)
  mounted = dispose
  return () => {
    if (mounted !== dispose) return
    mounted = null
    dispose()
  }
}
