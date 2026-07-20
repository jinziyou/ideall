import { isNodeKind, type Node } from "@protocol/node"
import type { SubscriptionType } from "@protocol/subscription"
import { WORKSPACE_ARCHIVE_LIMITS, type WorkspaceArchiveLimits } from "@protocol/workspace-archive"
import { notifyFilesUpdated } from "@protocol/flowback"
import { base64ToBytes, bytesToBase64, isBase64 } from "@/lib/base64"
import {
  decryptWorkspaceArchive,
  encryptWorkspaceArchive,
  isEncryptedWorkspaceArchive,
} from "@/lib/workspace-archive-crypto"
import {
  idbGetAll,
  idbReplaceStores,
  STORE_BLOBS,
  STORE_NODES,
  STORE_TRASH_SNAPSHOTS,
} from "@/lib/idb"
import {
  parseWorkspaceBackupPackage,
  stringifyWorkspaceBackupPackage,
  type PluginDataInspection,
  type PluginDataPort,
  type PluginImportResult,
  type WorkspaceBackupPackage,
} from "@/plugins/shared/plugin-data"
import {
  exportWorkspaceBackupJson,
  importWorkspaceBackupPackage,
  previewPluginDataImport,
  type PluginDataImportBackup,
  type PluginDataImportExecution,
  type PluginDataImportPreview,
  type PluginDataRestoreExecution,
} from "@/plugins/shared/plugin-data-manager"
import { WORKSPACE_STORAGE_KEY } from "@/lib/workspace-storage"

export const WORKSPACE_ARCHIVE_PACKAGE_KIND = "ideall.workspace-archive"
export const WORKSPACE_ARCHIVE_PACKAGE_VERSION = 2

const WORKSPACE_ARCHIVE_ID = "workspace-archive"
const WORKSPACE_ARCHIVE_LABEL = "完整工作区"

type BlobRecord = { key: string; blob: Blob }

type PersistedWorkspaceSnapshot = {
  tabs: Record<string, unknown>[]
  activeId: string | null
  transientId: string | null
  activeModule: string
  workspaceKind: "files" | "audio" | "development"
  developmentTool: "git" | "shell"
  sidebarCollapsed: boolean
  rightPanelOpen: boolean
}

export type SerializedBlobRecord = {
  key: string
  mime: string
  size: number
  dataBase64: string
}

export type SerializedTrashSnapshot = {
  id: string
  node: Node
  blob?: SerializedBlobRecord
  capturedAt: number
}

export type WorkspaceArchiveManifest = {
  algorithm: "crc32"
  checksum: string
  nodeCount: number
  blobCount: number
  blobBytes: number
  trashSnapshotCount: number
  pluginCount: number
  tabCount: number
}

type WorkspaceArchivePayload = {
  kind: typeof WORKSPACE_ARCHIVE_PACKAGE_KIND
  exportedAt: string
  core: {
    nodes: Node[]
    blobs: SerializedBlobRecord[]
    trashSnapshots: SerializedTrashSnapshot[]
    workspace: PersistedWorkspaceSnapshot | null
  }
  plugins: WorkspaceBackupPackage
}

export type WorkspaceArchivePackage = WorkspaceArchivePayload & {
  version: typeof WORKSPACE_ARCHIVE_PACKAGE_VERSION
  manifest: WorkspaceArchiveManifest
}

export type WorkspaceArchiveImportPreview = PluginDataImportPreview & {
  encrypted?: boolean
  requiresPassphrase?: boolean
  archive?: {
    nodeCount: number
    blobCount: number
    trashSnapshotCount: number
    pluginCount: number
    tabCount: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} 格式无效`)
  return value
}

function bytesOf(raw: string): number {
  return new TextEncoder().encode(raw).byteLength
}

function assertWithinLimit(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} 超出归档限制（最大 ${maximum}）`)
  }
}

function assertRawArchiveLimit(raw: string, limits: WorkspaceArchiveLimits): void {
  if (raw.length > limits.maxPlaintextBytes) {
    throw new Error(
      `工作区归档过大（至少 ${raw.length} 字节，最大 ${limits.maxPlaintextBytes} 字节）`,
    )
  }
  const bytes = bytesOf(raw)
  if (bytes > limits.maxPlaintextBytes) {
    throw new Error(`工作区归档过大（${bytes} 字节，最大 ${limits.maxPlaintextBytes} 字节）`)
  }
}

function crc32(raw: string): string {
  let checksum = 0xffffffff
  for (const byte of new TextEncoder().encode(raw)) {
    checksum ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0)
    }
  }
  return ((checksum ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0")
}

function workspaceArchiveManifest(
  exportedAt: string,
  core: WorkspaceArchivePayload["core"],
  plugins: WorkspaceBackupPackage,
): WorkspaceArchiveManifest {
  return {
    algorithm: "crc32",
    checksum: crc32(JSON.stringify({ exportedAt, core, plugins })),
    nodeCount: core.nodes.length,
    blobCount: core.blobs.length,
    blobBytes: core.blobs.reduce((total, blob) => total + blob.size, 0),
    trashSnapshotCount: core.trashSnapshots.length,
    pluginCount: plugins.plugins.length,
    tabCount: core.workspace?.tabs.length ?? 0,
  }
}

function normalizeWorkspaceArchiveManifest(
  value: unknown,
  expected: WorkspaceArchiveManifest,
): WorkspaceArchiveManifest {
  const manifest = requireRecord(value, "manifest")
  const normalized: WorkspaceArchiveManifest = {
    algorithm: manifest.algorithm === "crc32" ? "crc32" : invalidManifest("algorithm"),
    checksum: requireString(manifest.checksum, "manifest.checksum"),
    nodeCount: requireNonNegativeNumber(manifest.nodeCount, "manifest.nodeCount"),
    blobCount: requireNonNegativeNumber(manifest.blobCount, "manifest.blobCount"),
    blobBytes: requireNonNegativeNumber(manifest.blobBytes, "manifest.blobBytes"),
    trashSnapshotCount: requireNonNegativeNumber(
      manifest.trashSnapshotCount,
      "manifest.trashSnapshotCount",
    ),
    pluginCount: requireNonNegativeNumber(manifest.pluginCount, "manifest.pluginCount"),
    tabCount: requireNonNegativeNumber(manifest.tabCount, "manifest.tabCount"),
  }
  if (!/^[0-9a-f]{8}$/.test(normalized.checksum)) invalidManifest("checksum")
  for (const key of [
    "checksum",
    "nodeCount",
    "blobCount",
    "blobBytes",
    "trashSnapshotCount",
    "pluginCount",
    "tabCount",
  ] as const) {
    if (normalized[key] !== expected[key]) {
      throw new Error(`工作区归档 manifest.${key} 校验失败`)
    }
  }
  return normalized
}

function invalidManifest(field: string): never {
  throw new Error(`工作区归档 manifest.${field} 格式无效`)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} 格式无效`)
  return value
}

function requireStringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} 格式无效`)
  return value
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 格式无效`)
  return value
}

function requireNonNegativeNumber(value: unknown, label: string): number {
  const n = requireNumber(value, label)
  if (n < 0) throw new Error(`${label} 格式无效`)
  return n
}

function optionalNumber(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : requireNumber(value, label)
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireString(value, label)
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  return requireString(value, label)
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} 格式无效`)
  }
  return [...value]
}

function normalizeMeta(value: unknown, label: string): Record<string, unknown> {
  return { ...requireRecord(value, label) }
}

function requireBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!isBase64(value)) {
    throw new Error("base64 格式无效")
  }
  return base64ToBytes(value)
}

async function blobToSerialized(record: BlobRecord): Promise<SerializedBlobRecord> {
  return {
    key: record.key,
    mime: record.blob.type,
    size: record.blob.size,
    dataBase64: bytesToBase64(new Uint8Array(await record.blob.arrayBuffer())),
  }
}

function serializedToBlob(record: SerializedBlobRecord): BlobRecord {
  const bytes = requireBase64(record.dataBase64)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return { key: record.key, blob: new Blob([buffer], { type: record.mime }) }
}

function normalizeSerializedBlob(
  value: unknown,
  label: string,
  limits: WorkspaceArchiveLimits,
): SerializedBlobRecord {
  if (!isRecord(value)) throw new Error(`${label} 格式无效`)
  const size = requireNonNegativeNumber(value.size, `${label}.size`)
  assertWithinLimit(size, limits.maxSingleBlobBytes, `${label}.size`)
  const dataBase64 = requireStringValue(value.dataBase64, `${label}.dataBase64`)
  const bytes = requireBase64(dataBase64)
  if (bytes.byteLength !== size) throw new Error(`${label}.size 与 dataBase64 不一致`)
  return {
    key: requireString(value.key, `${label}.key`),
    mime: typeof value.mime === "string" ? value.mime : "",
    size,
    dataBase64,
  }
}

function normalizeNode(value: unknown, label: string): Node {
  if (!isRecord(value)) throw new Error(`${label} 格式无效`)
  const kind = requireString(value.kind, `${label}.kind`)
  if (!isNodeKind(kind)) throw new Error(`${label}.kind 格式无效`)
  const deletedAt = optionalNumber(value.deletedAt, `${label}.deletedAt`)
  const meta = value.meta === undefined ? undefined : normalizeMeta(value.meta, `${label}.meta`)
  const base = {
    id: requireString(value.id, `${label}.id`),
    parentId: requireNullableString(value.parentId, `${label}.parentId`),
    sortKey: requireString(value.sortKey, `${label}.sortKey`),
    title: typeof value.title === "string" ? value.title : "",
    tags: requireStringArray(value.tags, `${label}.tags`),
    createdAt: requireNumber(value.createdAt, `${label}.createdAt`),
    updatedAt: requireNumber(value.updatedAt, `${label}.updatedAt`),
    ...(deletedAt === undefined ? {} : { deletedAt }),
    ...(meta === undefined ? {} : { meta }),
  }
  switch (kind) {
    case "folder":
      if (value.content !== undefined && value.content !== null) {
        throw new Error(`${label}.content 格式无效`)
      }
      return { ...base, kind, content: null }
    case "note":
      if (!Array.isArray(value.content)) throw new Error(`${label}.content 格式无效`)
      return { ...base, kind, content: value.content }
    case "bookmark": {
      const content = requireRecord(value.content, `${label}.content`)
      return {
        ...base,
        kind,
        content: {
          url: requireString(content.url, `${label}.content.url`),
          description: typeof content.description === "string" ? content.description : "",
          favicon: typeof content.favicon === "string" ? content.favicon : "",
        },
      }
    }
    case "file": {
      const blobRef = requireRecord(value.blobRef, `${label}.blobRef`)
      if (value.content !== undefined && value.content !== null) {
        throw new Error(`${label}.content 格式无效`)
      }
      return {
        ...base,
        kind,
        blobRef: {
          store: blobRef.store === "blobs" ? "blobs" : invalidBlobStore(`${label}.blobRef.store`),
          key: requireString(blobRef.key, `${label}.blobRef.key`),
          size: requireNonNegativeNumber(blobRef.size, `${label}.blobRef.size`),
          mime: typeof blobRef.mime === "string" ? blobRef.mime : "",
        },
        content: null,
      }
    }
    case "feed": {
      const content = requireRecord(value.content, `${label}.content`)
      const type = requireString(content.type, `${label}.content.type`)
      if (!["publisher", "entity", "tool", "search", "peer"].includes(type)) {
        throw new Error(`${label}.content.type 格式无效`)
      }
      const entityLabel = optionalString(content.entityLabel, `${label}.content.entityLabel`)
      const entityName = optionalString(content.entityName, `${label}.content.entityName`)
      const searchKeyword = optionalString(content.searchKeyword, `${label}.content.searchKeyword`)
      const searchDomain = optionalString(content.searchDomain, `${label}.content.searchDomain`)
      return {
        ...base,
        kind,
        content: {
          type: type as SubscriptionType,
          key: requireString(content.key, `${label}.content.key`),
          favicon: typeof content.favicon === "string" ? content.favicon : "",
          ...(entityLabel === undefined ? {} : { entityLabel }),
          ...(entityName === undefined ? {} : { entityName }),
          ...(searchKeyword === undefined ? {} : { searchKeyword }),
          ...(searchDomain === undefined ? {} : { searchDomain }),
        },
      }
    }
    case "thread": {
      const content = requireRecord(value.content, `${label}.content`)
      if (!Array.isArray(content.messages)) throw new Error(`${label}.content.messages 格式无效`)
      return { ...base, kind, content: { messages: content.messages } }
    }
  }
}

function normalizeTrashSnapshot(
  value: unknown,
  index: number,
  limits: WorkspaceArchiveLimits,
): SerializedTrashSnapshot {
  if (!isRecord(value)) throw new Error(`trashSnapshots[${index}] 格式无效`)
  const blob = value.blob
  return {
    id: requireString(value.id, `trashSnapshots[${index}].id`),
    node: normalizeNode(value.node, `trashSnapshots[${index}].node`),
    blob:
      blob === undefined
        ? undefined
        : normalizeSerializedBlob(blob, `trashSnapshots[${index}].blob`, limits),
    capturedAt: requireNumber(value.capturedAt, `trashSnapshots[${index}].capturedAt`),
  }
}

function invalidBlobStore(label: string): never {
  throw new Error(`${label} 格式无效`)
}

function nullableWorkspaceString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function normalizeWorkspaceSnapshot(value: unknown): PersistedWorkspaceSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null
  const workspaceKind =
    value.workspaceKind === "audio" || value.workspaceKind === "development"
      ? value.workspaceKind
      : "files"
  return {
    tabs: value.tabs.filter(isRecord),
    activeId: nullableWorkspaceString(value.activeId),
    transientId: nullableWorkspaceString(value.transientId),
    activeModule: typeof value.activeModule === "string" ? value.activeModule : "home",
    workspaceKind,
    developmentTool: value.developmentTool === "shell" ? "shell" : "git",
    sidebarCollapsed: value.sidebarCollapsed === true,
    rightPanelOpen: value.rightPanelOpen === true,
  }
}

function readWorkspaceSnapshot(): PersistedWorkspaceSnapshot | null {
  try {
    const raw =
      globalThis.sessionStorage?.getItem(WORKSPACE_STORAGE_KEY) ??
      globalThis.localStorage?.getItem(WORKSPACE_STORAGE_KEY)
    if (!raw) return null
    return normalizeWorkspaceSnapshot(JSON.parse(raw))
  } catch {
    return null
  }
}

function applyWorkspaceSnapshot(snapshot: PersistedWorkspaceSnapshot | null): void {
  try {
    if (!snapshot) {
      globalThis.sessionStorage?.removeItem(WORKSPACE_STORAGE_KEY)
      globalThis.localStorage?.removeItem(WORKSPACE_STORAGE_KEY)
      return
    }
    const raw = JSON.stringify(snapshot)
    globalThis.sessionStorage?.setItem(WORKSPACE_STORAGE_KEY, raw)
    globalThis.localStorage?.setItem(WORKSPACE_STORAGE_KEY, raw)
  } catch {
    /* 隐私模式 / 配额满时忽略标签布局恢复。 */
  }
}

async function serializeTrashSnapshot(snapshot: {
  id: string
  node: Node
  blob?: Blob
  capturedAt: number
}): Promise<SerializedTrashSnapshot> {
  return {
    id: snapshot.id,
    node: snapshot.node,
    blob: snapshot.blob
      ? await blobToSerialized({ key: snapshot.id, blob: snapshot.blob })
      : undefined,
    capturedAt: snapshot.capturedAt,
  }
}

export function createWorkspaceArchivePackage(
  input: Pick<WorkspaceArchivePayload, "core" | "plugins">,
  exportedAt = new Date().toISOString(),
): WorkspaceArchivePackage {
  return {
    kind: WORKSPACE_ARCHIVE_PACKAGE_KIND,
    version: WORKSPACE_ARCHIVE_PACKAGE_VERSION,
    exportedAt,
    ...input,
    manifest: workspaceArchiveManifest(exportedAt, input.core, input.plugins),
  }
}

export function parseWorkspaceArchivePackage(
  raw: string,
  limits: WorkspaceArchiveLimits = WORKSPACE_ARCHIVE_LIMITS,
): WorkspaceArchivePackage {
  assertRawArchiveLimit(raw, limits)
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) throw new Error("工作区归档 JSON 格式无效")
  if (parsed.kind !== WORKSPACE_ARCHIVE_PACKAGE_KIND) {
    throw new Error("不支持的工作区归档 JSON 版本")
  }
  if (parsed.version !== WORKSPACE_ARCHIVE_PACKAGE_VERSION) {
    throw new Error("不支持的工作区归档 JSON 版本")
  }
  if (!isRecord(parsed.core)) throw new Error("工作区归档缺少 core")
  const core = parsed.core
  if (!Array.isArray(core.nodes)) throw new Error("工作区归档缺少 core.nodes")
  if (!Array.isArray(core.blobs)) throw new Error("工作区归档缺少 core.blobs")
  if (!Array.isArray(core.trashSnapshots)) {
    throw new Error("工作区归档缺少 core.trashSnapshots")
  }
  assertWithinLimit(core.nodes.length, limits.maxNodes, "core.nodes 数量")
  assertWithinLimit(core.blobs.length, limits.maxBlobs, "core.blobs 数量")
  assertWithinLimit(
    core.trashSnapshots.length,
    limits.maxTrashSnapshots,
    "core.trashSnapshots 数量",
  )
  const pluginEnvelope = requireRecord(parsed.plugins, "plugins")
  if (!Array.isArray(pluginEnvelope.plugins)) throw new Error("工作区归档缺少 plugins.plugins")
  assertWithinLimit(pluginEnvelope.plugins.length, limits.maxPlugins, "plugins.plugins 数量")
  if (isRecord(core.workspace) && Array.isArray(core.workspace.tabs)) {
    assertWithinLimit(core.workspace.tabs.length, limits.maxTabs, "core.workspace.tabs 数量")
  }
  const exportedAt = requireString(parsed.exportedAt, "exportedAt")
  const normalizedBlobs = core.blobs.map((blob, index) =>
    normalizeSerializedBlob(blob, `blobs[${index}]`, limits),
  )
  const normalizedTrash = core.trashSnapshots.map((snapshot, index) =>
    normalizeTrashSnapshot(snapshot, index, limits),
  )
  const allNormalizedBlobs = [
    ...normalizedBlobs,
    ...normalizedTrash.flatMap((item) => item.blob ?? []),
  ]
  assertWithinLimit(allNormalizedBlobs.length, limits.maxBlobs, "归档 Blob 数量")
  const totalBlobBytes = allNormalizedBlobs.reduce((total, blob) => total + blob.size, 0)
  assertWithinLimit(totalBlobBytes, limits.maxTotalBlobBytes, "Blob 总字节数")
  const normalized: WorkspaceArchivePayload = {
    kind: WORKSPACE_ARCHIVE_PACKAGE_KIND,
    exportedAt,
    core: {
      nodes: core.nodes.map((node, index) => normalizeNode(node, `nodes[${index}]`)),
      blobs: normalizedBlobs,
      trashSnapshots: normalizedTrash,
      workspace: normalizeWorkspaceSnapshot(core.workspace),
    },
    plugins: parseWorkspaceBackupPackage(JSON.stringify(parsed.plugins)),
  }
  const expectedManifest = workspaceArchiveManifest(exportedAt, normalized.core, normalized.plugins)
  expectedManifest.checksum = crc32(
    JSON.stringify({ exportedAt, core: parsed.core, plugins: parsed.plugins }),
  )
  const manifest = normalizeWorkspaceArchiveManifest(parsed.manifest, expectedManifest)
  return { ...normalized, version: WORKSPACE_ARCHIVE_PACKAGE_VERSION, manifest }
}

export function stringifyWorkspaceArchivePackage(
  pack: WorkspaceArchivePackage,
  limits: WorkspaceArchiveLimits = WORKSPACE_ARCHIVE_LIMITS,
): string {
  assertWithinLimit(pack.core.nodes.length, limits.maxNodes, "core.nodes 数量")
  assertWithinLimit(pack.core.blobs.length, limits.maxBlobs, "core.blobs 数量")
  assertWithinLimit(
    pack.core.trashSnapshots.length,
    limits.maxTrashSnapshots,
    "core.trashSnapshots 数量",
  )
  assertWithinLimit(pack.plugins.plugins.length, limits.maxPlugins, "plugins.plugins 数量")
  assertWithinLimit(
    pack.core.workspace?.tabs.length ?? 0,
    limits.maxTabs,
    "core.workspace.tabs 数量",
  )
  const allBlobs = [
    ...pack.core.blobs,
    ...pack.core.trashSnapshots.flatMap((snapshot) => snapshot.blob ?? []),
  ]
  assertWithinLimit(allBlobs.length, limits.maxBlobs, "归档 Blob 数量")
  for (const [index, blob] of allBlobs.entries()) {
    assertWithinLimit(blob.size, limits.maxSingleBlobBytes, `Blob[${index}].size`)
  }
  assertWithinLimit(
    allBlobs.reduce((total, blob) => total + blob.size, 0),
    limits.maxTotalBlobBytes,
    "Blob 总字节数",
  )
  const raw = JSON.stringify(pack, null, 2)
  assertRawArchiveLimit(raw, limits)
  return raw
}

export function isWorkspaceArchiveRaw(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown }
    return parsed?.kind === WORKSPACE_ARCHIVE_PACKAGE_KIND
  } catch {
    return false
  }
}

function archiveSummary(
  pack: WorkspaceArchivePackage,
): NonNullable<PluginDataImportPreview["package"]> {
  return {
    pluginId: WORKSPACE_ARCHIVE_ID,
    pluginLabel: WORKSPACE_ARCHIVE_LABEL,
    dataKind: WORKSPACE_ARCHIVE_PACKAGE_KIND,
    dataVersion: pack.version,
    exportedAt: pack.exportedAt,
  }
}

function archiveTarget(): NonNullable<PluginDataImportPreview["target"]> {
  return {
    pluginId: WORKSPACE_ARCHIVE_ID,
    pluginLabel: WORKSPACE_ARCHIVE_LABEL,
    dataKind: WORKSPACE_ARCHIVE_PACKAGE_KIND,
    dataVersion: WORKSPACE_ARCHIVE_PACKAGE_VERSION,
    importMode: "replace",
    importDescription:
      "导入会替换核心节点、文件 Blob、回收站快照与所有插件数据；标签布局写回后在刷新时生效。",
  }
}

function archivePayload(
  pack: WorkspaceArchivePackage,
): NonNullable<WorkspaceArchiveImportPreview["archive"]> {
  return {
    nodeCount: pack.core.nodes.length,
    blobCount: pack.core.blobs.length,
    trashSnapshotCount: pack.core.trashSnapshots.length,
    pluginCount: pack.plugins.plugins.length,
    tabCount: pack.core.workspace?.tabs.length ?? 0,
  }
}

function archiveInspection(pack: WorkspaceArchivePackage, bytes?: number): PluginDataInspection {
  const payload = archivePayload(pack)
  return {
    pluginId: WORKSPACE_ARCHIVE_ID,
    label: WORKSPACE_ARCHIVE_LABEL,
    dataKind: WORKSPACE_ARCHIVE_PACKAGE_KIND,
    dataVersion: pack.version,
    status: payload.nodeCount || payload.blobCount || payload.pluginCount ? "ready" : "empty",
    itemCount:
      payload.nodeCount + payload.blobCount + payload.trashSnapshotCount + payload.pluginCount,
    bytes: bytes ?? bytesOf(stringifyWorkspaceArchivePackage(pack)),
    updatedAt: Number.isFinite(Date.parse(pack.exportedAt)) ? Date.parse(pack.exportedAt) : null,
    detail: `${payload.nodeCount} 个节点 / ${payload.blobCount} 个 Blob / ${payload.trashSnapshotCount} 个回收站快照 / ${payload.pluginCount} 个插件`,
  }
}

export async function exportWorkspaceArchiveJson(): Promise<string> {
  const [nodes, blobs, trashSnapshots, pluginBackupRaw] = await Promise.all([
    idbGetAll<Node>(STORE_NODES),
    idbGetAll<BlobRecord>(STORE_BLOBS),
    idbGetAll<{ id: string; node: Node; blob?: Blob; capturedAt: number }>(STORE_TRASH_SNAPSHOTS),
    exportWorkspaceBackupJson(),
  ])
  assertWithinLimit(nodes.length, WORKSPACE_ARCHIVE_LIMITS.maxNodes, "core.nodes 数量")
  assertWithinLimit(
    trashSnapshots.length,
    WORKSPACE_ARCHIVE_LIMITS.maxTrashSnapshots,
    "core.trashSnapshots 数量",
  )
  const sourceBlobs = [
    ...blobs.map((record) => record.blob),
    ...trashSnapshots.flatMap((snapshot) => snapshot.blob ?? []),
  ]
  assertWithinLimit(sourceBlobs.length, WORKSPACE_ARCHIVE_LIMITS.maxBlobs, "归档 Blob 数量")
  for (const [index, blob] of sourceBlobs.entries()) {
    assertWithinLimit(blob.size, WORKSPACE_ARCHIVE_LIMITS.maxSingleBlobBytes, `Blob[${index}].size`)
  }
  assertWithinLimit(
    sourceBlobs.reduce((total, blob) => total + blob.size, 0),
    WORKSPACE_ARCHIVE_LIMITS.maxTotalBlobBytes,
    "Blob 总字节数",
  )
  const pack = createWorkspaceArchivePackage({
    core: {
      nodes,
      blobs: await Promise.all(blobs.map(blobToSerialized)),
      trashSnapshots: await Promise.all(trashSnapshots.map(serializeTrashSnapshot)),
      workspace: readWorkspaceSnapshot(),
    },
    plugins: parseWorkspaceBackupPackage(pluginBackupRaw),
  })
  return stringifyWorkspaceArchivePackage(pack)
}

export async function exportWorkspaceArchiveEncrypted(passphrase: string): Promise<string> {
  return encryptWorkspaceArchive(await exportWorkspaceArchiveJson(), passphrase)
}

export async function previewWorkspaceArchiveImport(
  raw: string,
  filename?: string,
  ports?: readonly PluginDataPort[],
  passphrase?: string,
): Promise<WorkspaceArchiveImportPreview> {
  const encrypted = isEncryptedWorkspaceArchive(raw)
  if (encrypted && !passphrase) {
    return {
      ok: false,
      filename,
      encrypted: true,
      requiresPassphrase: true,
      error: "请输入归档口令",
    }
  }
  if (encrypted) {
    try {
      raw = await decryptWorkspaceArchive(raw, passphrase ?? "")
    } catch (error) {
      return {
        ok: false,
        filename,
        encrypted: true,
        requiresPassphrase: true,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  let pack: WorkspaceArchivePackage
  try {
    pack = parseWorkspaceArchivePackage(raw)
  } catch (error) {
    return {
      ok: false,
      filename,
      encrypted,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const pluginPreview = await previewPluginDataImport(
    stringifyWorkspaceBackupPackage(pack.plugins),
    undefined,
    ports,
  )
  if (!pluginPreview.ok) {
    return {
      ok: false,
      filename,
      encrypted,
      package: archiveSummary(pack),
      archive: archivePayload(pack),
      error: pluginPreview.error ?? "工作区归档中的插件备份无法导入",
    }
  }

  return {
    ok: true,
    filename,
    encrypted,
    requiresPassphrase: false,
    package: archiveSummary(pack),
    target: archiveTarget(),
    archive: archivePayload(pack),
    current: archiveInspection(pack, bytesOf(raw)),
  }
}

async function createWorkspaceArchiveBackup(): Promise<PluginDataImportBackup> {
  const raw = await exportWorkspaceArchiveJson()
  return {
    pluginId: WORKSPACE_ARCHIVE_ID,
    pluginLabel: WORKSPACE_ARCHIVE_LABEL,
    dataKind: WORKSPACE_ARCHIVE_PACKAGE_KIND,
    dataVersion: WORKSPACE_ARCHIVE_PACKAGE_VERSION,
    createdAt: new Date().toISOString(),
    raw,
    bytes: bytesOf(raw),
  }
}

async function applyWorkspaceArchivePackage(
  pack: WorkspaceArchivePackage,
): Promise<PluginImportResult> {
  const blobRecords = pack.core.blobs.map(serializedToBlob)
  const trashSnapshots = pack.core.trashSnapshots.map((snapshot) => ({
    id: snapshot.id,
    node: snapshot.node,
    blob: snapshot.blob ? serializedToBlob(snapshot.blob).blob : undefined,
    capturedAt: snapshot.capturedAt,
  }))

  await idbReplaceStores(
    [STORE_NODES, STORE_BLOBS, STORE_TRASH_SNAPSHOTS],
    [
      ...pack.core.nodes.map((node) => ({ store: STORE_NODES, value: node })),
      ...blobRecords.map((record) => ({ store: STORE_BLOBS, value: record })),
      ...trashSnapshots.map((snapshot) => ({ store: STORE_TRASH_SNAPSHOTS, value: snapshot })),
    ],
  )
  applyWorkspaceSnapshot(pack.core.workspace)
  await importWorkspaceBackupPackage(stringifyWorkspaceBackupPackage(pack.plugins))
  notifyFilesUpdated()
  return {
    nodes: pack.core.nodes.length,
    blobs: pack.core.blobs.length,
    trash: pack.core.trashSnapshots.length,
    plugins: pack.plugins.plugins.length,
  }
}

export async function importWorkspaceArchiveJson(
  raw: string,
  filename?: string,
  passphrase?: string,
): Promise<PluginDataImportExecution> {
  const encrypted = isEncryptedWorkspaceArchive(raw)
  const plaintext = encrypted ? await decryptWorkspaceArchive(raw, passphrase ?? "") : raw
  const preview = await previewWorkspaceArchiveImport(plaintext, filename)
  if (!preview.ok || !preview.package) {
    throw new Error(preview.error ?? "工作区归档无法导入")
  }
  const executionPreview: WorkspaceArchiveImportPreview = {
    ...preview,
    encrypted,
    requiresPassphrase: false,
  }
  const pack = parseWorkspaceArchivePackage(plaintext)
  const backup = await createWorkspaceArchiveBackup()
  let result: PluginImportResult
  try {
    result = await applyWorkspaceArchivePackage(pack)
  } catch (error) {
    try {
      await restoreWorkspaceArchiveBackup(backup)
    } catch {
      /* 保留原始导入错误; 备份仍在 UI 中可手动恢复。 */
    }
    throw error
  }
  return {
    preview: executionPreview,
    backup,
    result,
    after: archiveInspection(pack, bytesOf(plaintext)),
  }
}

export async function restoreWorkspaceArchiveBackup(
  backup: PluginDataImportBackup,
): Promise<PluginDataRestoreExecution> {
  const pack = parseWorkspaceArchivePackage(backup.raw)
  const result = await applyWorkspaceArchivePackage(pack)
  return { result, after: archiveInspection(pack, backup.bytes) }
}
