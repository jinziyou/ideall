/** 工作区归档 wire 与资源预算。纯契约，供设置 UI 和归档实现共同使用。 */
export const WORKSPACE_ARCHIVE_ENCRYPTED_KIND = "ideall.workspace-archive-encrypted"
export const WORKSPACE_ARCHIVE_ENCRYPTED_VERSION = 1

const MIB = 1024 * 1024

export type WorkspaceArchiveLimits = Readonly<{
  maxPlaintextBytes: number
  maxEnvelopeBytes: number
  maxNodes: number
  maxBlobs: number
  maxSingleBlobBytes: number
  maxTotalBlobBytes: number
  maxTrashSnapshots: number
  maxPlugins: number
  maxTabs: number
}>

/**
 * JSON + Base64 归档会同时占用字符串、解码缓冲和 Blob 内存；在改为流式容器前必须有硬上限。
 * 160 MiB Blob 经 Base64 后约 214 MiB，给节点/插件 JSON 留出余量。
 */
export const WORKSPACE_ARCHIVE_LIMITS: WorkspaceArchiveLimits = Object.freeze({
  maxPlaintextBytes: 256 * MIB,
  maxEnvelopeBytes: 352 * MIB,
  maxNodes: 250_000,
  maxBlobs: 25_000,
  maxSingleBlobBytes: 64 * MIB,
  maxTotalBlobBytes: 160 * MIB,
  maxTrashSnapshots: 100_000,
  maxPlugins: 128,
  maxTabs: 1_000,
})

export const WORKSPACE_ARCHIVE_MIN_PASSPHRASE_LENGTH = 12
export const WORKSPACE_ARCHIVE_MAX_PASSPHRASE_LENGTH = 1_024
export const WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS = 600_000
