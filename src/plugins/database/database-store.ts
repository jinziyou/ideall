// 数据库插件 —— 本地表工作台。数据存独立 IndexedDB, 不进入统一 Node 库。

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

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      dbPromise = null
      reject(new Error("当前环境不支持 IndexedDB"))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
    req.onblocked = () => {
      dbPromise = null
      reject(new Error("IndexedDB 升级被其它标签页阻塞"))
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_TABLES)) {
        db.createObjectStore(STORE_TABLES, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(STORE_ROWS)) {
        const rows = db.createObjectStore(STORE_ROWS, { keyPath: "id" })
        rows.createIndex("tableId", "tableId", { unique: false })
      }
    }
  })
  return dbPromise
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb()
  const tx = db.transaction(storeName, "readonly")
  return requestToPromise<T[]>(tx.objectStore(storeName).getAll())
}

async function put<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(storeName, "readwrite")
  await requestToPromise(tx.objectStore(storeName).put(value))
}

async function remove(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(storeName, "readwrite")
  await requestToPromise(tx.objectStore(storeName).delete(key))
}

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

export async function listTables(): Promise<DataTable[]> {
  const tables = await getAll<DataTable>(STORE_TABLES)
  return tables.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createTable(name: string, columns: string[]): Promise<DataTable> {
  const cleanName = name.trim()
  if (!cleanName) throw new Error("需要表名")
  if (!columns.length) throw new Error("至少需要一个字段")
  const now = Date.now()
  const table: DataTable = {
    id: makeId("table"),
    name: cleanName,
    columns,
    createdAt: now,
    updatedAt: now,
  }
  await put(STORE_TABLES, table)
  return table
}

export async function deleteTable(id: string): Promise<void> {
  const db = await openDb()
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
  const db = await openDb()
  const tx = db.transaction(STORE_ROWS, "readonly")
  const rows = await requestToPromise<DataRow[]>(
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
  await put(STORE_ROWS, row)
  return row
}

export async function updateRow(
  id: string,
  tableId: string,
  values: Record<string, string>,
): Promise<DataRow> {
  const now = Date.now()
  const row: DataRow = { id, tableId, values, createdAt: now, updatedAt: now }
  await put(STORE_ROWS, row)
  return row
}

export async function deleteRow(id: string): Promise<void> {
  await remove(STORE_ROWS, id)
}
