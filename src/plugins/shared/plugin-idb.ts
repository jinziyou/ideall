export type PluginDbConfig = {
  name: string
  version: number
  blockedMessage?: string
  upgrade: (db: IDBDatabase, tx: IDBTransaction | null, event: IDBVersionChangeEvent) => void
}

export type PluginDb = ReturnType<typeof createPluginDb>

export function createPluginDb(config: PluginDbConfig) {
  let dbPromise: Promise<IDBDatabase> | null = null

  const open = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        dbPromise = null
        reject(new Error("当前环境不支持 IndexedDB"))
        return
      }
      const req = indexedDB.open(config.name, config.version)
      req.onerror = () => {
        dbPromise = null
        reject(req.error ?? new Error(`打开 IndexedDB ${config.name} 失败`))
      }
      req.onblocked = () => {
        dbPromise = null
        reject(new Error(config.blockedMessage ?? "IndexedDB 升级被其它标签页阻塞"))
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        ;(db as IDBDatabase & { onclose?: () => void }).onclose = () => {
          dbPromise = null
        }
        resolve(db)
      }
      req.onupgradeneeded = (event) => {
        try {
          config.upgrade(req.result, req.transaction, event)
        } catch (error) {
          req.transaction?.abort()
          throw error
        }
      }
    })
    return dbPromise
  }

  const request = <T>(req: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error("IndexedDB 请求失败"))
    })

  const transactionDone = (tx: IDBTransaction): Promise<void> =>
    new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 事务失败"))
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB 事务已中止"))
    })

  const getAll = async <T>(storeName: string): Promise<T[]> => {
    const db = await open()
    const tx = db.transaction(storeName, "readonly")
    return request<T[]>(tx.objectStore(storeName).getAll())
  }

  const get = async <T>(storeName: string, key: IDBValidKey): Promise<T | undefined> => {
    const db = await open()
    const tx = db.transaction(storeName, "readonly")
    return request<T | undefined>(tx.objectStore(storeName).get(key))
  }

  const put = async <T>(storeName: string, value: T): Promise<void> => {
    const db = await open()
    const tx = db.transaction(storeName, "readwrite")
    tx.objectStore(storeName).put(value)
    await transactionDone(tx)
  }

  const remove = async (storeName: string, key: IDBValidKey): Promise<void> => {
    const db = await open()
    const tx = db.transaction(storeName, "readwrite")
    tx.objectStore(storeName).delete(key)
    await transactionDone(tx)
  }

  const clear = async (storeName: string): Promise<void> => {
    const db = await open()
    const tx = db.transaction(storeName, "readwrite")
    tx.objectStore(storeName).clear()
    await transactionDone(tx)
  }

  const close = async (): Promise<void> => {
    const db = await open()
    db.close()
    dbPromise = null
  }

  return { open, request, getAll, get, put, remove, clear, close }
}
