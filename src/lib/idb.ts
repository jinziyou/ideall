// 极简 IndexedDB 封装 —— Home 模块本地优先存储的底层。
// 不引入额外依赖, 用 Promise 包装原生 API。对象仓库:
//   nodes —— 统一 Node 库 (一切皆文件), keyPath = id; 按 kind 收纳所有内容节点 (note/bookmark/folder/file/feed/thread)
//   blobs —— 文件二进制旁存 ({key,blob}, keyPath = key); 文件节点存 blobRef 指向此处, Blob 不进同步
//   trash_snapshots —— 回收站本机快照, 用于恢复会被同步删除标记压缩掉的正文 / Blob。
//   agent_tasks —— thread 的本机任务关系与 revision/count/migration state, keyPath = key。

// IndexedDB 实例名保持历史 "wonita-home": IndexedDB 不能原子重命名, 直接改名会让老用户本地数据看似丢失。
export const IDB_DATABASE_NAME = "wonita-home"
// onupgradeneeded 只声明 object store/index schema，不执行应用层读写或数据迁移
// (浏览器仍会为新增索引构建索引；报错会 abort DB open 且无恢复 UI)。
// 版本号只升不降, 否则既有库会 VersionError; onversionchange 让旧标签页主动让位避免 onblocked 冻结。
export const IDB_DATABASE_VERSION = 17

export const STORE_NODES = "nodes"
export const STORE_BLOBS = "blobs"
export const STORE_TRASH_SNAPSHOTS = "trash_snapshots"
export const STORE_AGENT_TASKS = "agent_tasks"
export const INDEX_NODES_DELETED_AT = "deletedAt"
export const INDEX_NODES_KIND = "kind"
/** kind 目录的排序覆盖索引；reverse key cursor 可 O(1) 取得尾键且不 clone 节点正文。 */
export const INDEX_NODES_KIND_SORT_KEY = "kindSortKey"
/** kind 目录稳定游标索引；title/id 为重复 sortKey 提供确定性续读位置。 */
export const INDEX_NODES_KIND_SORT_TITLE_ID = "kindSortTitleId"
/**
 * 线程 metadata 覆盖索引。metadata 读取只遍历 index key，不读取 value，避免 IndexedDB
 * structured-clone 完整 messages。kind 放首位，后续可用 compound range 只扫描 thread。
 */
export const INDEX_NODES_THREAD_METADATA = "threadMetadata"
export const INDEX_NODES_PARENT_ID = "parentId"
const INDEX_NODES_UPDATED_AT = "updatedAt"

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      dbPromise = null // 允许后续重试 (如 SSR 后客户端再调)
      reject(new Error("当前环境不支持 IndexedDB"))
      return
    }
    const req = indexedDB.open(IDB_DATABASE_NAME, IDB_DATABASE_VERSION)
    let blocked = false
    req.onupgradeneeded = () => {
      if (blocked) {
        req.transaction?.abort()
        return
      }
      const db = req.result
      const nodes = db.objectStoreNames.contains(STORE_NODES)
        ? req.transaction?.objectStore(STORE_NODES)
        : db.createObjectStore(STORE_NODES, { keyPath: "id" })
      if (nodes && !nodes.indexNames.contains(INDEX_NODES_DELETED_AT)) {
        nodes.createIndex(INDEX_NODES_DELETED_AT, "deletedAt", { unique: false })
      }
      if (nodes && !nodes.indexNames.contains(INDEX_NODES_KIND)) {
        nodes.createIndex(INDEX_NODES_KIND, "kind", { unique: false })
      }
      if (nodes && !nodes.indexNames.contains(INDEX_NODES_KIND_SORT_KEY)) {
        nodes.createIndex(INDEX_NODES_KIND_SORT_KEY, ["kind", "sortKey"], { unique: false })
      }
      if (nodes && !nodes.indexNames.contains(INDEX_NODES_KIND_SORT_TITLE_ID)) {
        nodes.createIndex(INDEX_NODES_KIND_SORT_TITLE_ID, ["kind", "sortKey", "title", "id"], {
          unique: false,
        })
      }
      if (nodes && !nodes.indexNames.contains(INDEX_NODES_PARENT_ID)) {
        nodes.createIndex(INDEX_NODES_PARENT_ID, "parentId", { unique: false })
      }
      if (nodes && !nodes.indexNames.contains(INDEX_NODES_UPDATED_AT)) {
        nodes.createIndex(INDEX_NODES_UPDATED_AT, "updatedAt", { unique: false })
      }
      if (nodes && !nodes.indexNames.contains(INDEX_NODES_THREAD_METADATA)) {
        nodes.createIndex(
          INDEX_NODES_THREAD_METADATA,
          ["kind", "id", "title", "updatedAt", "sortKey", "createdAt"],
          { unique: false },
        )
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: "key" })
      }
      if (!db.objectStoreNames.contains(STORE_TRASH_SNAPSHOTS)) {
        db.createObjectStore(STORE_TRASH_SNAPSHOTS, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(STORE_AGENT_TASKS)) {
        db.createObjectStore(STORE_AGENT_TASKS, { keyPath: "key" })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // onblocked 已向调用方失败；迟到的成功连接不能泄漏或悄悄替换后续重试。
      if (blocked) {
        db.close()
        return
      }
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
      if (blocked) return
      blocked = true
      dbPromise = null
      reject(new Error("IndexedDB 升级被其它标签页阻塞, 请关闭其它 ideall 标签页后重试"))
    }
  })
  return dbPromise
}

/**
 * 执行一个原生 IndexedDB 事务，并在事务真正 complete 后返回 executor 设置的结果。
 *
 * executor 必须在当前调用栈或 IDBRequest 回调中同步派生后续请求，不能 await 外部 Promise，
 * 否则浏览器可能在 await 期间自动提交事务。事件回调中的领域校验失败应调用 abort(error)，
 * 以确保所有对象仓库一起回滚，并保留可读的原始错误。
 */
export async function idbRunTransaction<T>(
  storeNames: readonly string[],
  mode: IDBTransactionMode,
  executor: (
    transaction: IDBTransaction,
    setResult: (result: T) => void,
    abort: (error: unknown) => void,
  ) => void,
): Promise<T> {
  if (storeNames.length === 0) throw new Error("IndexedDB 事务至少需要一个对象仓库")
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([...new Set(storeNames)], mode)
    let result: T | undefined
    let hasResult = false
    let explicitError: unknown
    let settled = false

    const fail = (error: unknown) => {
      if (explicitError === undefined) explicitError = error
      try {
        transaction.abort()
      } catch {
        if (!settled) {
          settled = true
          reject(explicitError)
        }
      }
    }

    transaction.oncomplete = () => {
      if (settled) return
      settled = true
      if (!hasResult) {
        reject(new Error("IndexedDB 事务已提交，但没有产生结果"))
        return
      }
      resolve(result as T)
    }
    transaction.onerror = () => {
      if (settled) return
      settled = true
      reject(explicitError ?? transaction.error ?? new Error("IndexedDB 事务失败"))
    }
    transaction.onabort = () => {
      if (settled) return
      settled = true
      reject(explicitError ?? transaction.error ?? new Error("IndexedDB 事务已中止"))
    }

    try {
      executor(
        transaction,
        (next) => {
          result = next
          hasResult = true
        },
        fail,
      )
    } catch (error) {
      fail(error)
    }
  })
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

/** 在同一 readonly 事务中读取多个对象仓库的计数，供健康诊断使用且不 clone 正文。 */
export async function idbCountStores(
  storeNames: readonly string[],
): Promise<Record<string, number>> {
  const names = [...new Set(storeNames)]
  if (names.length === 0) return {}
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(names, "readonly")
    const result: Record<string, number> = {}
    for (const name of names) {
      const request = transaction.objectStore(name).count()
      request.onsuccess = () => {
        result[name] = request.result
      }
    }
    transaction.oncomplete = () => resolve(result)
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB 计数失败"))
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 计数已中止"))
  })
}

export async function idbGetAllFromIndex<T>(
  storeName: string,
  indexName: string,
  query?: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  return withStore<T[]>(storeName, "readonly", (store) => {
    const index = store.index(indexName)
    return query === undefined ? index.getAll() : index.getAll(query)
  })
}

export async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return withStore<T | undefined>(storeName, "readonly", (store) => store.get(key))
}

/** 按输入 key 顺序在同一 readonly 事务内批量读取，避免逐项打开 IndexedDB 事务。 */
export async function idbGetMany<T>(
  storeName: string,
  keys: readonly IDBValidKey[],
): Promise<Array<T | undefined>> {
  if (keys.length === 0) return []
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly")
    const store = tx.objectStore(storeName)
    const results = new Array<T | undefined>(keys.length)
    for (let index = 0; index < keys.length; index += 1) {
      const request = store.get(keys[index] as IDBValidKey)
      request.onsuccess = () => {
        results[index] = request.result as T | undefined
      }
    }
    tx.oncomplete = () => resolve(results)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export type IDBIndexKeyEntry = {
  readonly key: IDBValidKey
  readonly primaryKey: IDBValidKey
}

/**
 * 在同一 readonly 事务内读取覆盖索引 key，并取得另一索引命中的主键集合。
 *
 * 与 index.getAll() 不同，openKeyCursor() 不会把对象仓库 value（例如 thread.messages）
 * structured-clone 到 JS；excludedIndex 常用于一次性排除软删除记录。
 */
export async function idbReadIndexKeySnapshot(
  storeName: string,
  indexName: string,
  query: IDBValidKey | IDBKeyRange | undefined,
  excludedIndexName: string,
): Promise<{ entries: IDBIndexKeyEntry[]; excludedPrimaryKeys: IDBValidKey[] }> {
  return idbReadIndexKeyRangesSnapshot(storeName, indexName, [query], excludedIndexName)
}

/** 与 idbReadIndexKeySnapshot 相同，但在一个事务内执行多个 point/range key cursor。 */
export async function idbReadIndexKeyRangesSnapshot(
  storeName: string,
  indexName: string,
  queries: readonly (IDBValidKey | IDBKeyRange | undefined)[],
  excludedIndexName: string,
): Promise<{ entries: IDBIndexKeyEntry[]; excludedPrimaryKeys: IDBValidKey[] }> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly")
    const store = tx.objectStore(storeName)
    const entries: IDBIndexKeyEntry[] = []
    let excludedPrimaryKeys: IDBValidKey[] = []

    const index = store.index(indexName)
    for (const query of queries) {
      const cursorRequest = index.openKeyCursor(query)
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor) return
        entries.push({ key: cursor.key, primaryKey: cursor.primaryKey })
        cursor.continue()
      }
    }
    const excludedRequest = store.index(excludedIndexName).getAllKeys()
    excludedRequest.onsuccess = () => {
      excludedPrimaryKeys = excludedRequest.result
    }

    tx.oncomplete = () => resolve({ entries, excludedPrimaryKeys })
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
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
 * 在同一事务内读取主记录，并仅在 predicate 仍成立时删除主记录及其关联记录。
 * 用于回收站永久删除：恢复与清理并发时，已恢复的 live node 不能被陈旧快照误删。
 */
export async function idbDeleteAcrossStoresIf<T>(
  storeNames: string[],
  primaryStore: string,
  key: IDBValidKey,
  predicate: (current: T) => boolean,
  relatedDeletes: (current: T) => { store: string; key: IDBValidKey }[],
): Promise<T | undefined> {
  const stores = [...new Set([primaryStore, ...storeNames])]
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite")
    const getReq = tx.objectStore(primaryStore).get(key)
    let deleted: T | undefined
    getReq.onsuccess = () => {
      try {
        const current = getReq.result as T | undefined
        if (!current || !predicate(current)) return
        deleted = current
        tx.objectStore(primaryStore).delete(key)
        for (const item of relatedDeletes(current)) {
          tx.objectStore(item.store).delete(item.key)
        }
      } catch (error) {
        reject(error)
        tx.abort()
      }
    }
    getReq.onerror = () => reject(getReq.error)
    tx.oncomplete = () => resolve(deleted)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/**
 * 单事务替换多个对象仓库: 先 clear 指定仓库, 再批量 put 新内容。
 * 用于完整工作区归档恢复, 避免 nodes/blobs/trash_snapshots 出现半导入状态。
 */
export async function idbReplaceStores(
  clears: string[],
  writes: { store: string; value: unknown }[],
): Promise<void> {
  const stores = [...new Set([...clears, ...writes.map((w) => w.store)])]
  if (!stores.length) return
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite")
    for (const storeName of clears) tx.objectStore(storeName).clear()
    for (const w of writes) tx.objectStore(w.store).put(w.value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/**
 * 单事务批量 put + delete —— 用于跨端同步落地: 写回合并后的完整数据与清理过期删除标记须原子,
 * 否则 put 成功后 delete 中断会留下「已写回但删除标记未清」的中间态 (与 FilesPort「一次事务批处理」承诺不符)。
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
