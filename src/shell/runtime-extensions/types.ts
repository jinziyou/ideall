import type { EngineDescriptor } from "@protocol/engine"
import type { FileSystemMountOptions } from "@/filesystem/composite-root"
import type { FileSystemProvider } from "@/filesystem/types"
import type { FileEngineRenderer } from "@/workspace/file-engine-renderer"

type MaybePromise<T> = T | Promise<T>

export type RuntimeFileSystemContribution = Readonly<{
  provider: FileSystemProvider
  mount: FileSystemMountOptions
}>

export type RuntimeEngineContribution = Readonly<{
  descriptor: EngineDescriptor
  renderer: FileEngineRenderer
}>

export type RuntimeExtensionDisposeReason =
  | "uninstall"
  | "revoke"
  | "factory-removed"
  | "activation-rollback"

export type RuntimeExtensionDisposeContext = Readonly<{
  /** dispose 被调用前一定已经 abort；connector 应让 socket/process/watch 同时监听该 signal。 */
  signal: AbortSignal
  reason: RuntimeExtensionDisposeReason
}>

/**
 * Factory.create 只构造贡献，不应启动外部资源。需要 socket/process/watch 的 connector 在
 * activate(signal) 中启动，在 dispose 中等待它们退出。宿主始终先 teardown 生命周期，之后
 * 才从 FileSystem/Engine registry 注销可见贡献。
 */
export type RuntimeExtensionContribution = Readonly<{
  id: string
  label: string
  fileSystems?: readonly RuntimeFileSystemContribution[]
  engines?: readonly RuntimeEngineContribution[]
  activate?(signal: AbortSignal): MaybePromise<void>
  dispose?(context: RuntimeExtensionDisposeContext): MaybePromise<void>
}>

export type RuntimeExtensionSource =
  | Readonly<{ kind: "builtin"; id: string }>
  | Readonly<{ kind: "package"; id: string; location?: string }>

/**
 * digest/permissionDigest 都由发行流水线或宿主 verifier 提供，本模块不会伪造哈希。
 * 对外部 package，verifier receipt 必须逐字段绑定这些值后才允许 consent/activate。
 */
export type RuntimeExtensionFactory = Readonly<{
  id: string
  label: string
  version: number
  source: RuntimeExtensionSource
  digest: string
  permissionDigest: string
  permissions: readonly string[]
  create(this: void): RuntimeExtensionContribution
}>

export type RuntimeExtensionDescriptor = Readonly<
  Pick<
    RuntimeExtensionFactory,
    "id" | "label" | "version" | "source" | "digest" | "permissionDigest" | "permissions"
  >
>

export type RuntimeExtensionVerificationReceipt = Readonly<{
  receiptId: string
  verifierId: string
  id: string
  version: number
  digest: string
  permissionDigest: string
  verifiedAt: number
}>

export type RuntimeExtensionConsentReceipt = Readonly<{
  receiptId: string
  id: string
  version: number
  digest: string
  permissionDigest: string
  grantedAt: number
}>

/** 外部 package 的 verifier 必须由桌面宿主注入；缺省即 fail closed。 */
export type RuntimeExtensionVerifier = Readonly<{
  verify(
    descriptor: RuntimeExtensionDescriptor,
  ): MaybePromise<RuntimeExtensionVerificationReceipt | null>
}>

/** Consent receipt 的签发和恢复同样由宿主注入；localStorage 中的字符串本身从不被信任。 */
export type RuntimeExtensionConsentAuthority = Readonly<{
  request(
    descriptor: RuntimeExtensionDescriptor,
    verification: RuntimeExtensionVerificationReceipt,
  ): MaybePromise<RuntimeExtensionConsentReceipt | null>
  restore(
    descriptor: RuntimeExtensionDescriptor,
    verification: RuntimeExtensionVerificationReceipt,
    persistedReceiptId: string,
  ): MaybePromise<RuntimeExtensionConsentReceipt | null>
  revoke?(receipt: RuntimeExtensionConsentReceipt): MaybePromise<void>
}>

export type RuntimeExtensionHost = Readonly<{
  batch?<T>(operation: () => T): T
  mountFileSystem(contribution: RuntimeFileSystemContribution): () => void
  registerEngine(contribution: RuntimeEngineContribution): () => void
}>
