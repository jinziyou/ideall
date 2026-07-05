// 数据库插件 —— 本地表工作台。数据存独立 IndexedDB, 不进入统一 Node 库。
import { createPluginDb } from "@/plugins/shared/plugin-idb"

const DB_NAME = "ideall:database"
const DB_VERSION = 1
const STORE_TABLES = "tables"
const STORE_ROWS = "rows"

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

const databaseDb = createPluginDb({
  name: DB_NAME,
  version: DB_VERSION,
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

export async function listTables(): Promise<DataTable[]> {
  const tables = await databaseDb.getAll<DataTable>(STORE_TABLES)
  return tables.sort((a, b) => b.updatedAt - a.updatedAt)
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
  const row: DataRow = { id, tableId, values, createdAt: current?.createdAt ?? now, updatedAt: now }
  await databaseDb.put(STORE_ROWS, row)
  return row
}

export async function deleteRow(id: string): Promise<void> {
  await databaseDb.remove(STORE_ROWS, id)
}
