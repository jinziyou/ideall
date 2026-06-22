// 极简 IndexedDB 封装 —— Home 模块本地优先存储的底层。
// 不引入额外依赖, 用 Promise 包装原生 API。对象仓库:
//   files          —— 文件 (含 Blob), keyPath = id
//   bookmarks      —— 链接收藏, keyPath = id
//   bookmarkFolders—— 收藏夹分组, keyPath = id
//   subscriptions  —— 「发现」订阅 (发布者等), keyPath = id
//   agentThreads   —— AI 助手对话线程 (消息内联存于线程文档), keyPath = id
//   notes          —— 笔记 (类 Notion 块文档, content 内联), keyPath = id
//   noteNotebooks  —— 笔记本分组, keyPath = id

const DB_NAME = "wonita-home"
// v2: 新增 subscriptions 仓库 (「发现」的来源订阅回流到 home)。
// v3: 新增 agentThreads 仓库 (AI 助手对话, 本地优先)。升级时旧仓库原样保留。
// v4: 新增 notes + noteNotebooks 仓库 (类 Notion 块编辑笔记, 本地优先)。纯增量, 旧仓库原样保留。
const DB_VERSION = 4

export const STORE_FILES = "files"
export const STORE_BOOKMARKS = "bookmarks"
export const STORE_FOLDERS = "bookmarkFolders"
export const STORE_SUBSCRIPTIONS = "subscriptions"
export const STORE_AGENT_THREADS = "agentThreads"
export const STORE_NOTES = "notes"
export const STORE_NOTEBOOKS = "noteNotebooks"

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      dbPromise = null // 允许后续重试 (如 SSR 后客户端再调)
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
      if (!db.objectStoreNames.contains(STORE_AGENT_THREADS)) {
        db.createObjectStore(STORE_AGENT_THREADS, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(STORE_NOTES)) {
        db.createObjectStore(STORE_NOTES, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(STORE_NOTEBOOKS)) {
        db.createObjectStore(STORE_NOTEBOOKS, { keyPath: "id" })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // 另一标签页请求版本升级时主动关闭本连接 (否则会阻塞对方的 upgrade), 并清空单例,
      // 使下次 openDB() 重新打开而非复用已 close 的连接 (复用会在 transaction 时抛 InvalidStateError)。
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      dbPromise = null // 打开失败 (配额 / 损坏 / 拒绝) 时清空单例, 允许后续重试恢复
      reject(req.error)
    }
    // 本页持旧版本连接、别的页加载新版本时, open 既不 success 也不 error 而是 blocked;
    // 不处理则该 Promise 永久 pending, 冻结本页全部 home 本地读写。转成可被上层 catch 的 reject。
    req.onblocked = () => {
      dbPromise = null
      reject(new Error("IndexedDB 升级被其它标签页阻塞, 请关闭其它 ideall 标签页后重试"))
    }
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
