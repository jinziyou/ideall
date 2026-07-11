import { RuntimeExtensionCatalog } from "./catalog"
import { RuntimeExtensionRegistry } from "./registry"
import type { ExtensionStorage } from "./persistence"

function browserExtensionStorage(): ExtensionStorage | undefined {
  if (typeof window === "undefined") return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export const runtimeExtensionRegistry = new RuntimeExtensionRegistry()

// 缺省没有 package verifier/consent authority，因此全局目录只能 discoverBuiltin；外部 loader 必须
// 由桌面宿主构造自己的 Catalog 或在后续 composition root 注入这两个 fail-closed 边界。
export const runtimeExtensionCatalog = new RuntimeExtensionCatalog(runtimeExtensionRegistry, {
  storage: browserExtensionStorage(),
})
