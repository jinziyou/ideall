// 本机内容 (文件 / 关注 / 书签 / 资源 / 对话) 的可搜索条目: 唯一数据来源, 供 ⌘K 统一面板消费
// (顶栏搜索框唤起同一面板; 旧的独立本地搜索对话框已并入)。每项含 run() 执行:
// 所有本机内容先作为 FileSystem 目录项加载, 再打开对应文件标签。

import type { ComponentType } from "react"
import { MessagesSquare, Plug } from "lucide-react"
import { fileRefKey, type DirectoryEntry } from "@protocol/file-system"
import type { NoteContent } from "@protocol/files"
import { nodeAgentContextSource, type AgentContextSource } from "@/lib/agent-context-tray"
import { onFilesUpdated, type FilesUpdate } from "@protocol/flowback"
import { noteText } from "@/files/note-text"
import { isLocalSemanticSearchEnabled } from "@/lib/local-semantic-settings"
import { loadLocalSemanticRuntime } from "./local-semantic-runtime-client"
import {
  deleteLocalSearchIndexDocument,
  localSearchIndexDocumentKey,
  putLocalSearchIndexDocument,
  readLocalSearchIndex,
  replaceLocalSearchIndex,
  type LocalSearchIndexDocument,
  type LocalSearchIndexField,
  type LocalSearchIndexGroup,
} from "@/files/local-search-index-store"
import { readCompleteDirectory, walkFileDirectory } from "@/filesystem/directory-walk"
import { readFile, readFiles, statFile } from "@/filesystem/registry"
import { IDEALL_ROOT_REF } from "@/filesystem/root-ref"
import {
  corePlaceRef,
  resourceFileRef,
  resourceRefForFile,
  type CorePlaceId,
} from "@/filesystem/resource-file-system"
import { MODULE_META } from "./module-meta"
import { openTarget } from "./store"
import type { OpenTarget } from "./open-target"

export type LocalSearchGroup = LocalSearchIndexGroup
export type LocalSearchItem = {
  id: string
  label: string
  group: LocalSearchGroup
  fileType?: { name: string; type: string }
  /** 非标题命中时展示的来源字段与片段，帮助用户理解结果为何出现。 */
  hint?: string
  target?: OpenTarget
  context?: AgentContextSource
  run: () => void
}

export const LOCAL_SEARCH_ORDER: LocalSearchGroup[] = [
  "文件",
  "关注",
  "书签",
  "资源",
  "对话",
  "连接器",
]

// 图标从 MODULE_META 派生 (分组名是本文件的展示口径, 与模块 label 恰好一致但语义独立)。
export const LOCAL_SEARCH_ICON: Record<LocalSearchGroup, ComponentType<{ className?: string }>> = {
  文件: MODULE_META.notes.icon,
  关注: MODULE_META.subscriptions.icon,
  书签: MODULE_META.bookmarks.icon,
  资源: MODULE_META.resources.icon,
  对话: MessagesSquare,
  连接器: Plug,
}

export type LocalSearchSource = {
  group: LocalSearchGroup
  place: CorePlaceId
  kind: "note" | "feed" | "bookmark" | "file" | "thread"
  descendKind?: "note" | "folder"
}

export const LOCAL_SEARCH_SOURCES: LocalSearchSource[] = [
  { group: "文件", place: "notes", kind: "note", descendKind: "note" },
  { group: "关注", place: "subscriptions", kind: "feed" },
  { group: "书签", place: "bookmarks", kind: "bookmark", descendKind: "folder" },
  { group: "资源", place: "files", kind: "file" },
  { group: "对话", place: "workspace", kind: "thread" },
]

export type LoadLocalSearchItemsOptions = {
  text?: string
  limitPerGroup?: number
}

export type RuntimeConnectorSearchLoader = (
  options: LoadLocalSearchItemsOptions,
) => Promise<LocalSearchItem[]>

function runTarget(target: OpenTarget): () => void {
  return () => openTarget(target)
}

function itemFromEntry(
  group: LocalSearchGroup,
  entry: DirectoryEntry,
  hint?: string,
): LocalSearchItem {
  const target: OpenTarget = { type: "file", ref: entry.target, title: entry.name }
  const resource = resourceRefForFile(entry.target)
  const fileType =
    resource?.scheme === "node" && resource.kind === "file"
      ? {
          name: entry.name,
          type: typeof entry.properties?.mediaType === "string" ? entry.properties.mediaType : "",
        }
      : undefined
  return {
    id: fileRefKey(entry.target),
    label: entry.name,
    group,
    ...(fileType ? { fileType } : {}),
    ...(hint ? { hint } : {}),
    ...(resource?.scheme === "node"
      ? { context: nodeAgentContextSource(resource.kind, resource.id, entry.name) }
      : {}),
    target,
    run: runTarget(target),
  }
}

export type LocalSearchEntryLoader = (
  source: LocalSearchSource,
  options: LoadLocalSearchItemsOptions,
) => Promise<DirectoryEntry[]>

export type LocalSearchContentLoader = (
  entries: readonly DirectoryEntry[],
) => Promise<readonly unknown[]>

const DIRECTORY_CONTEXT = { actor: "ui", permissions: [], intent: "directory" } as const

async function loadFileEntries(
  source: LocalSearchSource,
  _options: LoadLocalSearchItemsOptions,
): Promise<DirectoryEntry[]> {
  const entries = await walkFileDirectory(
    corePlaceRef(source.place),
    DIRECTORY_CONTEXT,
    (entry) => {
      const resource = resourceRefForFile(entry.target)
      return Boolean(
        source.descendKind && resource?.scheme === "node" && resource.kind === source.descendKind,
      )
    },
  )
  return entries.filter((entry) => {
    const resource = resourceRefForFile(entry.target)
    return resource?.scheme === "node" && resource.kind === source.kind
  })
}

const SEARCH_CONTENT_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "content",
} as const

async function loadSearchContents(entries: readonly DirectoryEntry[]): Promise<readonly unknown[]> {
  const results = await readFiles(
    entries.map((entry) => entry.target),
    SEARCH_CONTENT_CONTEXT,
    { encoding: "json" },
  )
  return results.map((result) => result?.data ?? null)
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

type SearchField = Readonly<{ label: string; value: string }>

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function threadText(content: unknown): string {
  const body = record(content)
  if (!body || !Array.isArray(body.messages)) return ""
  return body.messages
    .map((message) => record(message)?.content)
    .filter((value): value is string => typeof value === "string")
    .join(" ")
}

/** UI 专用搜索投影；Agent 的正文 consent 边界不复用也不扩大。 */
export function searchFields(data: unknown): SearchField[] {
  const node = record(data)
  if (!node || typeof node.kind !== "string") return []
  const tags = stringValues(node.tags)
  const fields: SearchField[] = tags.length ? [{ label: "标签", value: tags.join(" ") }] : []
  const content = record(node.content)
  switch (node.kind) {
    case "note":
      if (Array.isArray(node.content)) {
        fields.push({ label: "正文", value: noteText(node.content as NoteContent) })
      }
      break
    case "bookmark":
      if (content) {
        if (typeof content.url === "string") fields.push({ label: "网址", value: content.url })
        if (typeof content.description === "string") {
          fields.push({ label: "摘要", value: content.description })
        }
      }
      break
    case "feed":
      if (content) {
        const values = [
          content.key,
          content.entityLabel,
          content.entityName,
          content.searchKeyword,
          content.searchDomain,
        ].filter((value): value is string => typeof value === "string")
        if (values.length) fields.push({ label: "关注条件", value: values.join(" ") })
      }
      break
    case "thread": {
      const text = threadText(node.content)
      if (text) fields.push({ label: "对话", value: text })
      break
    }
    case "file": {
      const blobRef = record(node.blobRef)
      if (typeof blobRef?.mime === "string") {
        fields.push({ label: "类型", value: blobRef.mime })
      }
      break
    }
  }
  return fields
}

function matchExcerpt(value: string, normalizedQuery: string): string | null {
  const compact = value.replace(/\s+/g, " ").trim()
  const index = compact.toLocaleLowerCase().indexOf(normalizedQuery)
  if (index < 0) return null
  const start = Math.max(0, index - 36)
  const end = Math.min(compact.length, index + normalizedQuery.length + 64)
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`
}

function connectorSearchHint(entry: DirectoryEntry, normalizedQuery: string): string | undefined {
  const description =
    typeof entry.properties?.searchDescription === "string"
      ? entry.properties.searchDescription
      : ""
  const extensionLabel =
    typeof entry.properties?.extensionLabel === "string" ? entry.properties.extensionLabel : ""
  const descriptionMatch = matchExcerpt(description, normalizedQuery)
  if (descriptionMatch) return `描述 · ${descriptionMatch}`
  const sourceMatch = matchExcerpt(extensionLabel, normalizedQuery)
  if (sourceMatch) return `来源 · ${sourceMatch}`
  const mediaTypeMatch = matchExcerpt(entry.file?.mediaType ?? "", normalizedQuery)
  return mediaTypeMatch ? `类型 · ${mediaTypeMatch}` : undefined
}

export function runtimeConnectorSearchItemsFromEntries(
  entries: readonly DirectoryEntry[],
  options: LoadLocalSearchItemsOptions = {},
): LocalSearchItem[] {
  const normalizedQuery = options.text?.trim().toLocaleLowerCase() ?? ""
  const limit =
    options.limitPerGroup == null ? Number.POSITIVE_INFINITY : Math.max(0, options.limitPerGroup)
  if (limit === 0) return []
  const titleMatches: Array<{ entry: DirectoryEntry; hint?: string }> = []
  const metadataMatches: Array<{ entry: DirectoryEntry; hint?: string }> = []
  for (const entry of entries) {
    if (entry.properties?.runtimeExtensionSearchable !== true) continue
    if (!normalizedQuery || entry.name.toLocaleLowerCase().includes(normalizedQuery)) {
      titleMatches.push({ entry })
      continue
    }
    const hint = connectorSearchHint(entry, normalizedQuery)
    if (hint) metadataMatches.push({ entry, hint })
  }
  return [...titleMatches, ...metadataMatches].slice(0, limit).map(({ entry, hint }) => {
    const target: OpenTarget = { type: "file", ref: entry.target, title: entry.name }
    return {
      id: fileRefKey(entry.target),
      label: entry.name,
      group: "连接器" as const,
      ...(hint ? { hint } : {}),
      target,
      run: runTarget(target),
    }
  })
}

/**
 * 已授权 connector 只把 FileSystem metadata 投影到搜索；资源正文、URI、工具参数与调用结果
 * 均不进入本地搜索索引。connector 本身可随撤销立即卸载，因此这里按查询实时读取挂载。
 */
export async function loadRuntimeConnectorSearchItems(
  options: LoadLocalSearchItemsOptions = {},
): Promise<LocalSearchItem[]> {
  if (options.limitPerGroup === 0) return []
  let mounts: DirectoryEntry[]
  try {
    mounts = await readCompleteDirectory(IDEALL_ROOT_REF, DIRECTORY_CONTEXT)
  } catch {
    return []
  }
  const connectorMounts = mounts.filter(
    (entry) => entry.properties?.runtimeExtensionConnector === true,
  )
  const groups = await Promise.all(
    connectorMounts.map(async (mount) => {
      try {
        return await walkFileDirectory(mount.target, DIRECTORY_CONTEXT, (entry) =>
          Boolean(
            entry.file?.kind === "directory" ||
            entry.properties?.mcpEntryType === "resources" ||
            entry.properties?.mcpEntryType === "tools",
          ),
        )
      } catch {
        return []
      }
    }),
  )
  const entries = groups
    .flat()
    .filter((entry) => entry.properties?.runtimeExtensionSearchable === true)
  return runtimeConnectorSearchItemsFromEntries(entries, options)
}

function matchingHint(data: unknown, normalizedQuery: string): string | null {
  return matchingFieldsHint(searchFields(data), normalizedQuery)
}

function matchingFieldsHint(
  fields: readonly LocalSearchIndexField[],
  normalizedQuery: string,
): string | null {
  for (const field of fields) {
    const excerpt = matchExcerpt(field.value, normalizedQuery)
    if (excerpt) return `${field.label} · ${excerpt}`
  }
  return null
}

type SearchEntry = Readonly<{ entry: DirectoryEntry; hint?: string }>

async function matchingEntries(
  entries: readonly DirectoryEntry[],
  options: LoadLocalSearchItemsOptions,
  contentLoader: LocalSearchContentLoader,
): Promise<SearchEntry[]> {
  const normalizedQuery = options.text?.trim().toLocaleLowerCase()
  const limit =
    options.limitPerGroup == null ? Number.POSITIVE_INFINITY : Math.max(0, options.limitPerGroup)
  if (limit === 0) return []
  if (!normalizedQuery) return entries.slice(0, limit).map((entry) => ({ entry }))

  // 标题命中优先，且达到分组上限时无需读取任何正文。
  const titleMatches = entries
    .filter((entry) => entry.name.toLocaleLowerCase().includes(normalizedQuery))
    .map((entry) => ({ entry }))
  if (titleMatches.length >= limit) return titleMatches.slice(0, limit)

  const titleIds = new Set(titleMatches.map(({ entry }) => fileRefKey(entry.target)))
  const candidates = entries.filter((entry) => !titleIds.has(fileRefKey(entry.target)))
  if (candidates.length === 0) return titleMatches.slice(0, limit)
  let contents: readonly unknown[]
  try {
    contents = await contentLoader(candidates)
  } catch {
    // 正文批读失败时仍保留可靠的标题结果，不让单个 provider 破坏全局搜索。
    return titleMatches.slice(0, limit)
  }
  const contentMatches: SearchEntry[] = []
  for (let index = 0; index < candidates.length; index++) {
    const hint = matchingHint(contents[index], normalizedQuery)
    if (hint) contentMatches.push({ entry: candidates[index], hint })
    if (titleMatches.length + contentMatches.length >= limit) break
  }
  return [...titleMatches, ...contentMatches].slice(0, limit)
}

async function loadFileGroup(
  source: LocalSearchSource,
  options: LoadLocalSearchItemsOptions,
  loader: LocalSearchEntryLoader,
  contentLoader: LocalSearchContentLoader,
): Promise<LocalSearchItem[]> {
  try {
    const entries = await matchingEntries(await loader(source, options), options, contentLoader)
    return entries.map(({ entry, hint }) => itemFromEntry(source.group, entry, hint))
  } catch {
    return []
  }
}

const INDEXED_KINDS: ReadonlySet<string> = new Set(
  LOCAL_SEARCH_SOURCES.map((source) => source.kind),
)
const INDEX_BATCH_SIZE = 128
const METADATA_CONTEXT = { actor: "ui", permissions: [], intent: "metadata" } as const

function sourceForKind(kind: string): LocalSearchSource | undefined {
  return LOCAL_SEARCH_SOURCES.find((source) => source.kind === kind)
}

function indexDocument(
  source: LocalSearchSource,
  entry: Pick<DirectoryEntry, "target" | "name" | "properties" | "file">,
  data: unknown,
  sourceVersion: string | null,
): LocalSearchIndexDocument {
  const fileType =
    source.kind === "file"
      ? {
          name: entry.name,
          type:
            typeof entry.properties?.mediaType === "string"
              ? entry.properties.mediaType
              : (entry.file?.mediaType ?? ""),
        }
      : undefined
  return {
    key: localSearchIndexDocumentKey(entry.target),
    type: "document",
    target: entry.target,
    group: source.group,
    kind: source.kind,
    label: entry.name,
    ...(fileType ? { fileType } : {}),
    fields: searchFields(data),
    sourceVersion,
    indexedAt: Date.now(),
  }
}

function itemFromIndexDocument(document: LocalSearchIndexDocument, hint?: string): LocalSearchItem {
  const resource = resourceRefForFile(document.target)
  const target: OpenTarget = {
    type: "file",
    ref: document.target,
    title: document.label,
  }
  return {
    id: fileRefKey(document.target),
    label: document.label,
    group: document.group,
    ...(document.fileType ? { fileType: document.fileType } : {}),
    ...(hint ? { hint } : {}),
    ...(resource?.scheme === "node"
      ? { context: nodeAgentContextSource(resource.kind, resource.id, document.label) }
      : {}),
    target,
    run: runTarget(target),
  }
}

export function searchLocalIndexDocuments(
  documents: readonly LocalSearchIndexDocument[],
  options: LoadLocalSearchItemsOptions,
): LocalSearchItem[] {
  const normalizedQuery = options.text?.trim().toLocaleLowerCase() ?? ""
  const limit =
    options.limitPerGroup == null ? Number.POSITIVE_INFINITY : Math.max(0, options.limitPerGroup)
  const items: LocalSearchItem[] = []
  for (const group of LOCAL_SEARCH_ORDER) {
    const candidates = documents.filter((document) => document.group === group)
    if (!normalizedQuery) {
      items.push(...candidates.slice(0, limit).map((document) => itemFromIndexDocument(document)))
      continue
    }
    const titleMatches = candidates.filter((document) =>
      document.label.toLocaleLowerCase().includes(normalizedQuery),
    )
    const titleKeys = new Set(titleMatches.map((document) => document.key))
    const contentMatches: Array<{ document: LocalSearchIndexDocument; hint: string }> = []
    for (const document of candidates) {
      if (titleKeys.has(document.key)) continue
      const hint = matchingFieldsHint(document.fields, normalizedQuery)
      if (hint) contentMatches.push({ document, hint })
      if (titleMatches.length + contentMatches.length >= limit) break
    }
    items.push(
      ...titleMatches.slice(0, limit).map((document) => itemFromIndexDocument(document)),
      ...contentMatches
        .slice(0, Math.max(0, limit - titleMatches.length))
        .map(({ document, hint }) => itemFromIndexDocument(document, hint)),
    )
  }
  return items
}

export function materializeLocalSemanticResults(
  documents: readonly LocalSearchIndexDocument[],
  lexicalItems: readonly LocalSearchItem[],
  rankedDocumentKeys: readonly string[],
): LocalSearchItem[] {
  const documentsByKey = new Map(documents.map((document) => [document.key, document]))
  const lexicalByKey = new Map(
    lexicalItems.flatMap((item) => {
      const document = documents.find((candidate) => fileRefKey(candidate.target) === item.id)
      return document ? [[document.key, item] as const] : []
    }),
  )
  return rankedDocumentKeys.flatMap((key) => {
    const lexical = lexicalByKey.get(key)
    if (lexical) return [lexical]
    const document = documentsByKey.get(key)
    return document ? [itemFromIndexDocument(document, "语义相关")] : []
  })
}

export type LocalSearchIndexStatus = Readonly<{
  ready: boolean
  documentCount: number
  rebuiltAt: number | null
  lastQueryDurationMs: number | null
}>

export const LOCAL_SEARCH_INDEX_UPDATED = "ideall:local-search-index-updated"

let indexTail: Promise<unknown> = Promise.resolve()
let indexReceiverInstalled = false
let lastIndexQueryDurationMs: number | null = null

function enqueueIndexWork<T>(work: () => Promise<T>): Promise<T> {
  const scheduled = indexTail.catch(() => undefined).then(work)
  indexTail = scheduled
  return scheduled
}

function notifyIndexUpdated(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCAL_SEARCH_INDEX_UPDATED))
}

async function rebuildLocalSearchIndexNow(): Promise<LocalSearchIndexStatus> {
  const documents: LocalSearchIndexDocument[] = []
  for (const source of LOCAL_SEARCH_SOURCES) {
    const entries = await loadFileEntries(source, {})
    for (let offset = 0; offset < entries.length; offset += INDEX_BATCH_SIZE) {
      const batch = entries.slice(offset, offset + INDEX_BATCH_SIZE)
      const results = await readFiles(
        batch.map((entry) => entry.target),
        SEARCH_CONTENT_CONTEXT,
        { encoding: "json" },
      )
      for (let index = 0; index < batch.length; index++) {
        const result = results[index]
        if (!result) continue
        documents.push(indexDocument(source, batch[index], result.data, result.version ?? null))
      }
    }
  }
  await replaceLocalSearchIndex(documents)
  if (isLocalSemanticSearchEnabled()) {
    await loadLocalSemanticRuntime()
      .then(({ invalidateLocalSemanticSearch }) => invalidateLocalSemanticSearch())
      .catch(() => {})
  }
  const snapshot = await readLocalSearchIndex()
  notifyIndexUpdated()
  return {
    ready: snapshot.ready,
    documentCount: snapshot.documents.length,
    rebuiltAt: snapshot.rebuiltAt,
    lastQueryDurationMs: lastIndexQueryDurationMs,
  }
}

export function rebuildLocalSearchIndex(): Promise<LocalSearchIndexStatus> {
  return enqueueIndexWork(rebuildLocalSearchIndexNow)
}

async function ensureLocalSearchIndexNow(): Promise<void> {
  const snapshot = await readLocalSearchIndex()
  if (!snapshot.ready) await rebuildLocalSearchIndexNow()
}

function ensureLocalSearchIndex(): Promise<void> {
  return enqueueIndexWork(ensureLocalSearchIndexNow)
}

async function refreshIndexedNode(detail: Required<Pick<FilesUpdate, "kind" | "id">>) {
  const source = sourceForKind(detail.kind)
  if (!source) return
  const target = resourceFileRef({ scheme: "node", kind: source.kind, id: detail.id })
  const file = await statFile(target, METADATA_CONTEXT)
  if (!file) {
    await deleteLocalSearchIndexDocument(target)
    notifyIndexUpdated()
    if (isLocalSemanticSearchEnabled()) {
      void loadLocalSemanticRuntime()
        .then(({ refreshLocalSemanticDocument }) =>
          refreshLocalSemanticDocument(null, localSearchIndexDocumentKey(target)),
        )
        .catch(() => {})
    }
    return
  }
  const result = await readFile(target, SEARCH_CONTENT_CONTEXT, { encoding: "json" })
  const document = indexDocument(
    source,
    {
      target,
      name: file.name,
      file,
      properties: { mediaType: file.mediaType },
    },
    result.data,
    result.version ?? file.version ?? null,
  )
  await putLocalSearchIndexDocument(document)
  notifyIndexUpdated()
  if (isLocalSemanticSearchEnabled()) {
    void loadLocalSemanticRuntime()
      .then(({ refreshLocalSemanticDocument }) => refreshLocalSemanticDocument(document))
      .catch(() => {})
  }
}

function scheduleIndexUpdate(detail?: FilesUpdate): void {
  if (detail?.kind && detail.id && INDEXED_KINDS.has(detail.kind)) {
    const exact = { kind: detail.kind, id: detail.id }
    void enqueueIndexWork(async () => {
      await ensureLocalSearchIndexNow()
      await refreshIndexedNode(exact)
    }).catch(() => {})
    return
  }
  if (detail?.kind && !INDEXED_KINDS.has(detail.kind)) return
  void rebuildLocalSearchIndex().catch(() => {})
}

/** 安装一次增量索引维护器；源数据事件只携带失效标识，正文始终从 FileSystem 重读。 */
export function installLocalSearchIndex(): void {
  if (indexReceiverInstalled || typeof window === "undefined") return
  indexReceiverInstalled = true
  onFilesUpdated(scheduleIndexUpdate)
  void ensureLocalSearchIndex().catch(() => {})
}

export async function getLocalSearchIndexStatus(): Promise<LocalSearchIndexStatus> {
  const snapshot = await readLocalSearchIndex()
  return {
    ready: snapshot.ready,
    documentCount: snapshot.documents.length,
    rebuiltAt: snapshot.rebuiltAt,
    lastQueryDurationMs: lastIndexQueryDurationMs,
  }
}

/** 并行加载本机内容并构建可搜索/可执行条目 (按 文件→关注→书签→资源→对话 顺序)。 */
export async function loadLocalSearchItems(
  options: LoadLocalSearchItemsOptions = {},
  loader: LocalSearchEntryLoader = loadFileEntries,
  contentLoader: LocalSearchContentLoader = loadSearchContents,
  connectorLoader: RuntimeConnectorSearchLoader = loadRuntimeConnectorSearchItems,
): Promise<LocalSearchItem[]> {
  const normalizedQuery = options.text?.trim()
  if (normalizedQuery && loader === loadFileEntries && contentLoader === loadSearchContents) {
    try {
      const startedAt = performance.now()
      const snapshot = await readLocalSearchIndex()
      if (snapshot.ready) {
        const lexicalItems = searchLocalIndexDocuments(snapshot.documents, options)
        lastIndexQueryDurationMs = performance.now() - startedAt
        if (isLocalSemanticSearchEnabled() && normalizedQuery.length >= 2) {
          try {
            const semantic = await loadLocalSemanticRuntime()
            const semanticScores = await semantic.queryLocalSemanticScores(
              normalizedQuery,
              snapshot.documents,
            )
            const documentKeyByItemId = new Map(
              snapshot.documents.map((document) => [fileRefKey(document.target), document.key]),
            )
            const lexicalRanks = lexicalItems.flatMap((item) => {
              const documentKey = documentKeyByItemId.get(item.id)
              return documentKey
                ? [{ documentKey, group: item.group, titleMatch: item.hint == null }]
                : []
            })
            const rankedKeys = semantic.mergeLocalSemanticRanks(
              snapshot.documents,
              lexicalRanks,
              semanticScores,
              options.limitPerGroup,
            )
            return [
              ...materializeLocalSemanticResults(snapshot.documents, lexicalItems, rankedKeys),
              ...(await connectorLoader(options).catch(() => [])),
            ]
          } catch {
            // Worker、模型或向量索引失败时，字面检索仍是完整可用的降级路径。
          }
        }
        return [...lexicalItems, ...(await connectorLoader(options).catch(() => []))]
      }
      void ensureLocalSearchIndex().catch(() => {})
    } catch {
      // 派生索引损坏或不可用时退回 FileSystem 扫描；源数据始终是唯一真值。
    }
  }
  const [groups, connectors] = await Promise.all([
    Promise.all(
      LOCAL_SEARCH_SOURCES.map((source) => loadFileGroup(source, options, loader, contentLoader)),
    ),
    connectorLoader(options).catch(() => []),
  ])
  return [...groups.flat(), ...connectors]
}
