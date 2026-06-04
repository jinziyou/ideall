// 极简 IndexedDB 封装 —— Home 模块本地优先存储的底层。
// 不引入额外依赖, 用 Promise 包装原生 API。四个对象仓库:
//   files          —— 文件 (含 Blob), keyPath = id
//   bookmarks      —— 链接收藏, keyPath = id
//   bookmarkFolders—— 收藏夹分组, keyPath = id
//   subscriptions  —— 「发现」订阅 (发布者等), keyPath = id

const DB_NAME = "wonita-home"
// v2: 新增 subscriptions 仓库 (「发现」的来源订阅回流到 home); 升级时旧仓库原样保留。
const DB_VERSION = 2

export const STORE_FILES = "files"
export const STORE_BOOKMARKS = "bookmarks"
export const STORE_FOLDERS = "bookmarkFolders"
export const STORE_SUBSCRIPTIONS = "subscriptions"

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境不支持 IndexedDB"))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(STORE_BOOKMARKS)) {
        db.createObjectStore(STORE_BOOKMARKS, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        db.createObjectStore(STORE_FOLDERS, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(STORE_SUBSCRIPTIONS)) {
        db.createObjectStore(STORE_SUBSCRIPTIONS, { keyPath: "id" })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB()
  const tx = db.transaction(storeName, mode)
  const req = fn(tx.objectStore(storeName))
  return promisifyRequest(req)
}

export async function idbGetAll<T>(storeName: string): Promise<T[]> {
  return withStore<T[]>(storeName, "readonly", (store) => store.getAll())
}

export async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return withStore<T | undefined>(storeName, "readonly", (store) => store.get(key))
}

export async function idbPut<T>(storeName: string, value: T): Promise<void> {
  await withStore(storeName, "readwrite", (store) => store.put(value))
}

export async function idbBulkPut<T>(storeName: string, values: T[]): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const store = tx.objectStore(storeName)
    for (const v of values) store.put(v)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  await withStore(storeName, "readwrite", (store) => store.delete(key))
}
