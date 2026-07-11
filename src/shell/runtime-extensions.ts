// 运行时扩展兼容入口。实现按契约校验、Registry 生命周期、持久化信任、Catalog 状态机与
// 浏览器组合实例分层；消费方继续从本文件导入，避免扩大内部授权能力的可见范围。

export type {
  RuntimeEngineContribution,
  RuntimeExtensionConsentAuthority,
  RuntimeExtensionConsentReceipt,
  RuntimeExtensionContribution,
  RuntimeExtensionDescriptor,
  RuntimeExtensionDisposeContext,
  RuntimeExtensionDisposeReason,
  RuntimeExtensionFactory,
  RuntimeExtensionHost,
  RuntimeExtensionSource,
  RuntimeExtensionVerificationReceipt,
  RuntimeExtensionVerifier,
  RuntimeFileSystemContribution,
} from "./runtime-extensions/types"

export {
  RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY,
  type ExtensionStorage,
  type RuntimeExtensionInstallRecord,
} from "./runtime-extensions/persistence"

export {
  RuntimeExtensionRegistry,
  type RuntimeExtensionDisposeHandle,
  type RuntimeExtensionRegistryHealth,
} from "./runtime-extensions/registry"

export {
  RuntimeExtensionCatalog,
  type RuntimeExtensionCatalogOptions,
  type RuntimeExtensionCatalogState,
  type RuntimeExtensionHealth,
} from "./runtime-extensions/catalog"

export { runtimeExtensionCatalog, runtimeExtensionRegistry } from "./runtime-extensions/browser"
