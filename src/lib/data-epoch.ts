import { secureDelete, listSecureStoreKnownItems } from "./secure-store"

export const DATA_EPOCH_STORAGE_KEY = "ideall:data-epoch"
export const CURRENT_DATA_EPOCH = "2"

const OWNED_DATABASES = ["wonita-home", "ideall:audio", "ideall:database"] as const

let preparation: Promise<"current" | "reset"> | null = null

export type DataEpochDependencies = Readonly<{
  local: Pick<Storage, "getItem" | "setItem" | "clear">
  session: Pick<Storage, "clear">
  deleteDatabases: () => Promise<void>
  deleteSecrets: () => Promise<void>
}>

function deleteDatabase(name: string): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve()
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(`无法删除本地数据库 ${name}`))
    request.onblocked = () => reject(new Error(`本地数据库 ${name} 正被其它 ideall 窗口占用`))
  })
}

export async function ensureCurrentDataEpoch(
  dependencies: DataEpochDependencies,
): Promise<"current" | "reset"> {
  if (dependencies.local.getItem(DATA_EPOCH_STORAGE_KEY) === CURRENT_DATA_EPOCH) return "current"
  await dependencies.deleteSecrets()
  await dependencies.deleteDatabases()
  // ideall 是 App-only，同一 origin 下的 Web Storage 全部由应用管理。先清空 session，
  // 再清空 local 并写入新 epoch；只有所有耐久清理都成功后才允许启动。
  dependencies.session.clear()
  dependencies.local.clear()
  dependencies.local.setItem(DATA_EPOCH_STORAGE_KEY, CURRENT_DATA_EPOCH)
  return "reset"
}

/** 在任何 registry、provider 或工作区水合前建立当前破坏性数据基线。 */
export function prepareCurrentDataEpoch(): Promise<"current" | "reset"> {
  if (preparation) return preparation
  preparation = (async () => {
    if (typeof window === "undefined") return "current"
    return ensureCurrentDataEpoch({
      local: localStorage,
      session: sessionStorage,
      deleteDatabases: () => Promise.all(OWNED_DATABASES.map(deleteDatabase)).then(() => undefined),
      deleteSecrets: async () => {
        const secureKeys = [...new Set(listSecureStoreKnownItems().map((item) => item.key))]
        await Promise.all(secureKeys.map((key) => secureDelete(key)))
      },
    })
  })().catch((error) => {
    preparation = null
    throw error
  })
  return preparation
}
