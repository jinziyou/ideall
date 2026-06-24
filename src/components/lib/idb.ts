// 极简 IndexedDB 封装 —— Home 模块本地优先存储的底层。
// 不引入额外依赖, 用 Promise 包装原生 API。对象仓库:
//   files          —— 文件 (含 Blob), keyPath = id
//   bookmarks      —— 链接收藏, keyPath = id
//   bookmarkFolders—— 收藏夹分组, keyPath = id
//   subscriptions  —— 「发现」订阅 (发布者等), keyPath = id 【折叠步 C 后排空, 数据迁入 nodes (kind:"feed")】
//   agentThreads   —— AI 助手对话线程 (消息内联存于线程文档), keyPath = id
//   notes          —— 笔记 (类 Notion 块文档, content 内联), keyPath = id 【折叠步 A 后排空, 数据迁入 nodes】
//   noteNotebooks  —— 笔记本分组, keyPath = id 【已退役, 数据迁入 notes 再迁入 nodes】
//   nodes          —— 统一 Node 库 (一切皆文件), keyPath = id; 按 kind 收纳所有内容节点 (note/bookmark/folder/file…)
//   blobs          —— 文件二进制旁存 ({key,blob}, keyPath = key); 文件节点存 blobRef 指向此处, Blob 不进同步

const DB_NAME = "wonita-home"
// v2: 新增 subscriptions 仓库 (「发现」的来源订阅回流到 home)。
// v3: 新增 agentThreads 仓库 (AI 助手对话, 本地优先)。升级时旧仓库原样保留。
// v4: 新增 notes + noteNotebooks 仓库 (类 Notion 块编辑笔记, 本地优先)。纯增量, 旧仓库原样保留。
// v5: 笔记升级为递归页树 (notebookId→parentId + sortKey, 笔记本→根目录页)。无新仓库 (仍用 notes /
//     noteNotebooks); 数据形态迁移走 notes-store 的懒迁移 (migrateNotesTreeOnce, 可恢复/可 toast,
//     不在 onupgradeneeded 内做以免 abort 无恢复 UI)。版本号 +1 仅为让旧代码标签页主动让位 (onversionchange)。
// v6: 新增 nodes 仓库 (统一 Node 库, 折叠步 A: 笔记播种)。纯增量 (零 I/O upgrade), 旧仓库原样保留;
//     数据形态迁移 (notes→nodes, 加 kind:"note") 走 notes-store 的懒迁移 (seedNodesOnce), 同上不在 upgrade 内做。
// v7: 折叠步 B (书签/收藏夹迁入 nodes, kind:"bookmark"/"folder")。无新仓库 (零 I/O upgrade);
//     数据迁移走 bookmarks-store 的懒迁移 (seedBookmarksOnce)。版本号 +1 仅为让旧代码标签页主动让位 (onversionchange)。
// v8: 折叠步 B 续 (文件迁入 nodes, kind:"file") + 新增 blobs 仓库 (文件二进制旁存)。纯增量 (零 I/O upgrade);
//     数据迁移走 files-store 的懒迁移 (seedFilesOnce): 把内联 Blob 拆到 blobs, 节点存 blobRef。
// v9: 折叠步 C (订阅迁入 nodes, kind:"feed", 确定性 id feed:type:key)。无新仓库 (零 I/O upgrade);
//     数据迁移走 subscriptions-store 的懒迁移 (seedFeedsOnce); 同步仍走 "subs" scope (feed 节点↔旧 wire 投影)。
//     版本号 +1 仅为让旧代码标签页主动让位 (onversionchange)。
const DB_VERSION = 9

export const STORE_FILES = "files"
export const STORE_BOOKMARKS = "bookmarks"
export const STORE_FOLDERS = "bookmarkFolders"
export const STORE_SUBSCRIPTIONS = "subscriptions"
export const STORE_AGENT_THREADS = "agentThreads"
export const STORE_NOTES = "notes"
export const STORE_NOTEBOOKS = "noteNotebooks"
export const STORE_NODES = "nodes"
export const STORE_BLOBS = "blobs"

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
      if (!db.objectStoreNames.contains(STORE_NODES)) {
        db.createObjectStore(STORE_NODES, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: "key" })
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

/**
 * 仅取记录条数 —— 走原生 `IDBObjectStore.count()`, 不反序列化任何记录。
 * 用于只需计数的场景 (中枢/导航的数量徽标), 避免 idbGetAll 把全部文档 (含文件 Blob /
 * 笔记正文) 载入内存只为取 `.length`。注意: 软删除墓碑仓库 (subscriptions) 不可用此法 —— count()
 * 会把墓碑也计入, 仍需 listSubscriptions 过滤。
 */
export async function idbCount(storeName: string): Promise<number> {
  return withStore<number>(storeName, "readonly", (store) => store.count())
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

export async function idbBulkDelete(storeName: string, keys: IDBValidKey[]): Promise<void> {
  if (!keys.length) return
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const store = tx.objectStore(storeName)
    for (const k of keys) store.delete(k)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/**
 * 单事务读-改-写: 在同一个 readwrite 事务内 get(key) → mutate → put。
 * 取代「先 idbGet 读、再 idbPut 写」分处两个独立事务的写法 —— 后者在并发写 (如笔记正文自动保存
 * 与改标题同时进行, 或同步落地与编辑并发) 时, 后写会以陈旧快照覆盖前写 (丢更新)。
 * mutate 返回 undefined 表示放弃写入 (记录不存在等), 此时不产生 put。返回写入的值 (或 undefined)。
 */
export async function idbReadModifyWrite<T>(
  storeName: string,
  key: IDBValidKey,
  mutate: (current: T | undefined) => T | undefined,
): Promise<T | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const store = tx.objectStore(storeName)
    const getReq = store.get(key)
    let result: T | undefined
    getReq.onsuccess = () => {
      try {
        // mutate 在 get 的 onsuccess 内同步执行, 事务仍存活 → put 与 get 同事务原子。
        const next = mutate(getReq.result as T | undefined)
        result = next
        if (next !== undefined) store.put(next)
      } catch (err) {
        reject(err)
        tx.abort()
      }
    }
    getReq.onerror = () => reject(getReq.error)
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/**
 * 跨多个对象仓库的原子批量 put —— 同一 readwrite 事务写多仓, 任一失败整体回滚。
 * 用于「同生同灭」的跨仓记录, 如文件节点 (nodes) 与其旁存 Blob (blobs): 分两事务写时,
 * 若 Blob 已提交而节点写入中断 (如另一标签页触发版本升级关连接), 会留下无节点引用的孤儿 Blob (无 GC 路径)。
 */
export async function idbPutAcrossStores(
  writes: { store: string; value: unknown }[],
): Promise<void> {
  if (!writes.length) return
  const db = await openDB()
  const stores = [...new Set(writes.map((w) => w.store))]
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite")
    for (const w of writes) tx.objectStore(w.store).put(w.value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/**
 * 单事务批量 put + delete —— 用于跨端同步落地: 写回合并全集与清理过期墓碑须原子,
 * 否则 put 成功后 delete 中断会留下「已写回但墓碑未清」的中间态 (与 HubDataPort「一次事务批处理」承诺不符)。
 */
export async function idbBulkPutDelete<T>(
  storeName: string,
  puts: T[],
  deleteKeys: IDBValidKey[],
): Promise<void> {
  if (!puts.length && !deleteKeys.length) return
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const store = tx.objectStore(storeName)
    for (const v of puts) store.put(v)
    for (const k of deleteKeys) store.delete(k)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
