import { RuntimeExtensionCatalog } from "./catalog"
import { RuntimeExtensionRegistry } from "./registry"
import type { ExtensionStorage } from "./persistence"
import { createSecureRuntimeExtensionConsentAuthority } from "./secure-consent"
import { createRuntimeExtensionTrustBoundary, type RuntimeExtensionTrustHost } from "./trust-host"

function browserExtensionStorage(): ExtensionStorage | undefined {
  if (typeof window === "undefined") return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export const runtimeExtensionRegistry = new RuntimeExtensionRegistry()

const trustBoundary = createRuntimeExtensionTrustBoundary()

// verifier 仍必须由桌面宿主注入；consent 缺省进入系统凭据库。两条边界任一不可用都 fail closed。
export const runtimeExtensionCatalog = new RuntimeExtensionCatalog(runtimeExtensionRegistry, {
  storage: browserExtensionStorage(),
  verifier: trustBoundary.verifier,
  consent: createSecureRuntimeExtensionConsentAuthority(),
})

/** 由桌面 composition root 在首次验证 package 前调用一次。 */
export function configureRuntimeExtensionTrustHost(host: RuntimeExtensionTrustHost): void {
  trustBoundary.configure(host)
}
