/**
 * 非敏感浏览器配置的窄访问层。保留既有键和 localStorage 落点，只统一不可用/配额异常语义；
 * 密钥、令牌、同步码不得经过本模块，必须使用 secure-store。
 */
export type PublicConfigStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

export const THEME_KEY = "ideall:theme"
export const FILE_TREE_EXPANDED_STORAGE_KEY = "ideall:file-system-tree:expanded"
export const CAPTURE_ONBOARDING_STORAGE_KEY = "ideall:capture-onboarding:v1"

function browserLocalStorage(): PublicConfigStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function readPublicConfig(
  key: string,
  storage: PublicConfigStorage | undefined = browserLocalStorage(),
): string | null {
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

export function writePublicConfig(
  key: string,
  value: string,
  storage: PublicConfigStorage | undefined = browserLocalStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removePublicConfig(
  key: string,
  storage: PublicConfigStorage | undefined = browserLocalStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}
