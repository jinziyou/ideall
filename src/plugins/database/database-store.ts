// 数据库插件 —— 本地表工作台。数据存独立 IndexedDB, 不进入统一 Node 库。
import {
  createPluginDataPackage,
  parseExpectedPluginDataPackage,
  stringifyPluginDataPackage,
  type PluginDataPackage,
} from "@/plugins/shared/plugin-data"
import { createPluginDb } from "@/plugins/shared/plugin-idb"
import { nextUpdatedAt } from "@/files/version"

export const DATABASE_DB_NAME = "ideall:database"
export const DATABASE_DB_VERSION = 1
export const STORE_DATABASE_TABLES = "tables"
export const STORE_DATABASE_ROWS = "rows"
const STORE_TABLES = STORE_DATABASE_TABLES
const STORE_ROWS = STORE_DATABASE_ROWS

export type DataTable = {
  id: string
  name: string
  columns: string[]
  createdAt: number
  updatedAt: number
}

export type DataRow = {
  id: string
  tableId: string
  values: Record<string, string>
  createdAt: number
  updatedAt: number
}

export const DATABASE_PLUGIN_ID = "database"
export const DATABASE_PLUGIN_LABEL = "数据库"
export const DATABASE_EXPORT_KIND = "ideall.database.workspace"
export const DATABASE_EXPORT_VERSION = 1
export const DATABASE_DATA_SPEC = {
  pluginId: DATABASE_PLUGIN_ID,
  pluginLabel: DATABASE_PLUGIN_LABEL,
  dataKind: DATABASE_EXPORT_KIND,
  dataVersion: DATABASE_EXPORT_VERSION,
} as const

export type DatabaseExportTable = {
  table: DataTable
  rows: DataRow[]
}

export type DatabasePayload = {
  tables: DatabaseExportTable[]
}

export type DatabaseExport = PluginDataPackage<
  DatabasePayload,
  typeof DATABASE_EXPORT_KIND,
  typeof DATABASE_EXPORT_VERSION
>

const databaseDb = createPluginDb({
  name: DATABASE_DB_NAME,
  version: DATABASE_DB_VERSION,
  upgrade: (db) => {
    if (!db.objectStoreNames.contains(STORE_TABLES)) {
      db.createObjectStore(STORE_TABLES, { keyPath: "id" })
    }
    if (!db.objectStoreNames.contains(STORE_ROWS)) {
      const rows = db.createObjectStore(STORE_ROWS, { keyPath: "id" })
      rows.createIndex("tableId", "tableId", { unique: false })
    }
  },
})

function makeId(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeColumns(input: string): string[] {
  const seen = new Set<string>()
  return input
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => {
      const key = x.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function normalizeTableName(name: string): string {
  return name.trim()
}

export function validateTableDraft(
  name: string,
  columns: string[],
): { name: string; columns: string[] } {
  const cleanName = normalizeTableName(name)
  if (!cleanName) throw new Error("需要表名")
  if (!columns.length) throw new Error("至少需要一个字段")
  return { name: cleanName, columns }
}

export function rowValuesForColumns(
  columns: string[],
  draft: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(columns.map((column) => [column, draft[column]?.trim() ?? ""]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} 格式无效`)
  return value
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 格式无效`)
  return value
}

function normalizeTableRecord(value: unknown): DataTable {
  if (!isRecord(value)) throw new Error("表格式无效")
  const id = requireString(value.id, "表 id")
  const name = normalizeTableName(requireString(value.name, "表名"))
  const columns = Array.isArray(value.columns)
    ? value.columns.filter((column): column is string => typeof column === "string")
    : []
  validateTableDraft(name, columns)
  return {
    id,
    name,
    columns,
    createdAt: requireNumber(value.createdAt, "表 createdAt"),
    updatedAt: requireNumber(value.updatedAt, "表 updatedAt"),
  }
}

function normalizeRowRecord(value: unknown, tableId: string): DataRow {
  if (!isRecord(value)) throw new Error("行格式无效")
  const rawValues = isRecord(value.values) ? value.values : {}
  const values = Object.fromEntries(
    Object.entries(rawValues).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )
  return {
    id: requireString(value.id, "行 id"),
    tableId,
    values,
    createdAt: requireNumber(value.createdAt, "行 createdAt"),
    updatedAt: requireNumber(value.updatedAt, "行 updatedAt"),
  }
}

export function createDatabaseExport(
  tables: DatabaseExportTable[],
  exportedAt = new Date().toISOString(),
): DatabaseExport {
  return createPluginDataPackage(DATABASE_DATA_SPEC, { tables }, exportedAt)
}

export function parseDatabaseExport(raw: string): DatabaseExport {
  const pack = parseExpectedPluginDataPackage(raw, DATABASE_DATA_SPEC)
  if (!isRecord(pack.payload)) throw new Error("数据库 JSON 缺少 payload")
  if (!Array.isArray(pack.payload.tables)) throw new Error("数据库 JSON 缺少 tables")
  return createDatabaseExport(
    pack.payload.tables.map((item) => {
      if (!isRecord(item)) throw new Error("表导出项格式无效")
      const table = normalizeTableRecord(item.table)
      const rows = Array.isArray(item.rows)
        ? item.rows.map((row) => normalizeRowRecord(row, table.id))
        : []
      return { table, rows }
    }),
    pack.exportedAt,
  )
}

export async function listTables(): Promise<DataTable[]> {
  const tables = await databaseDb.getAll<DataTable>(STORE_TABLES)
  return tables.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 按主键读取单表，供 FileSystem.stat/read 避免为一个 FileRef 扫描全部表。 */
export async function getTable(id: string): Promise<DataTable | undefined> {
  return databaseDb.get<DataTable>(STORE_TABLES, id)
}

export async function createTable(name: string, columns: string[]): Promise<DataTable> {
  const draft = validateTableDraft(name, columns)
  const now = Date.now()
  const table: DataTable = {
    id: makeId("table"),
    name: draft.name,
    columns: draft.columns,
    createdAt: now,
    updatedAt: now,
  }
  await databaseDb.put(STORE_TABLES, table)
  return table
}

export async function deleteTable(id: string): Promise<void> {
  const db = await databaseDb.open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_TABLES, STORE_ROWS], "readwrite")
    tx.objectStore(STORE_TABLES).delete(id)
    const rowStore = tx.objectStore(STORE_ROWS)
    const index = rowStore.index("tableId")
    const req = index.openCursor(IDBKeyRange.only(id))
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      cursor.delete()
      cursor.continue()
    }
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function listRows(tableId: string): Promise<DataRow[]> {
  const db = await databaseDb.open()
  const tx = db.transaction(STORE_ROWS, "readonly")
  const rows = await databaseDb.request<DataRow[]>(
    tx.objectStore(STORE_ROWS).index("tableId").getAll(tableId),
  )
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

/** 按主键读取单行；调用方仍须校验 tableId，防止伪造 row FileRef 跨表寻址。 */
export async function getRow(id: string): Promise<DataRow | undefined> {
  return databaseDb.get<DataRow>(STORE_ROWS, id)
}

export async function addRow(tableId: string, values: Record<string, string>): Promise<DataRow> {
  const now = Date.now()
  const row: DataRow = {
    id: makeId("row"),
    tableId,
    values,
    createdAt: now,
    updatedAt: now,
  }
  await databaseDb.put(STORE_ROWS, row)
  return row
}

export async function updateRow(
  id: string,
  tableId: string,
  values: Record<string, string>,
): Promise<DataRow> {
  const now = Date.now()
  const current = await databaseDb.get<DataRow>(STORE_ROWS, id)
  const row: DataRow = {
    id,
    tableId,
    values,
    createdAt: current?.createdAt ?? now,
    updatedAt: current ? nextUpdatedAt(current.updatedAt, now) : now,
  }
  await databaseDb.put(STORE_ROWS, row)
  return row
}

export async function deleteRow(id: string): Promise<void> {
  await databaseDb.remove(STORE_ROWS, id)
}

export async function exportDatabaseJson(): Promise<string> {
  const tables = await listTables()
  const entries = await Promise.all(
    tables.map(async (table) => ({
      table,
      rows: await listRows(table.id),
    })),
  )
  return stringifyPluginDataPackage(createDatabaseExport(entries))
}

export async function importDatabaseJson(raw: string): Promise<{ tables: number; rows: number }> {
  const backup = parseDatabaseExport(raw)
  const db = await databaseDb.open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_TABLES, STORE_ROWS], "readwrite")
    const tables = tx.objectStore(STORE_TABLES)
    const rows = tx.objectStore(STORE_ROWS)
    tables.clear()
    rows.clear()
    for (const entry of backup.payload.tables) {
      tables.put(entry.table)
      for (const row of entry.rows) rows.put(row)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  return {
    tables: backup.payload.tables.length,
    rows: backup.payload.tables.reduce((sum, item) => sum + item.rows.length, 0),
  }
}

export async function inspectDatabaseData(): Promise<{
  tables: number
  rows: number
  bytes: number
  updatedAt: number | null
}> {
  const tables = await listTables()
  const entries = await Promise.all(
    tables.map(async (table) => ({
      table,
      rows: await listRows(table.id),
    })),
  )
  const json = JSON.stringify(entries)
  return {
    tables: entries.length,
    rows: entries.reduce((sum, entry) => sum + entry.rows.length, 0),
    bytes: new TextEncoder().encode(json).byteLength,
    updatedAt: entries.reduce<number | null>((latest, entry) => {
      const tableLatest = entry.rows.reduce(
        (rowLatest, row) => Math.max(rowLatest, row.updatedAt),
        entry.table.updatedAt,
      )
      return latest === null ? tableLatest : Math.max(latest, tableLatest)
    }, null),
  }
}
