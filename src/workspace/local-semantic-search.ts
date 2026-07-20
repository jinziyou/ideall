import type { LocalSearchIndexDocument } from "@/files/local-search-index-store"
import { readLocalSearchIndex } from "@/files/local-search-index-store"
import {
  MAX_LOCAL_SEMANTIC_INDEX_BYTES,
  MAX_LOCAL_SEMANTIC_DOCUMENTS,
  clearLocalSemanticIndex,
  createLocalSemanticVector,
  deleteLocalSemanticVector,
  putLocalSemanticVector,
  readLocalSemanticIndex,
  replaceLocalSemanticIndex,
  type LocalSemanticVector,
} from "@/files/local-semantic-index-store"
import {
  LOCAL_SEMANTIC_INDEX_UPDATED,
  LOCAL_SEMANTIC_MAX_BATCH_SIZE,
  LOCAL_SEMANTIC_MAX_INPUT_CHARS,
  LOCAL_SEMANTIC_MODEL_ID,
  LOCAL_SEMANTIC_VECTOR_DIMENSIONS,
} from "@/lib/local-semantic-contract"
import {
  deleteLocalSemanticModel,
  downloadLocalSemanticModel,
  getLocalSemanticModelStatus,
  type LocalSemanticModelProgress,
} from "@/lib/local-semantic-model"
import {
  isLocalSemanticSearchEnabled,
  setLocalSemanticSearchEnabled,
} from "@/lib/local-semantic-settings"
import {
  embedLocalSemanticTexts,
  terminateLocalSemanticWorker,
} from "./local-semantic-worker-client"

export type LocalSemanticSearchStatus = Readonly<{
  available: boolean
  enabled: boolean
  modelReady: boolean
  modelBytes: number
  modelExpectedBytes: number
  indexReady: boolean
  documentCount: number
  indexBytes: number
  rebuiltAt: number | null
  lastQueryDurationMs: number | null
}>

export type LocalSemanticBuildProgress = Readonly<{
  phase: "download" | "index"
  progress: number
  detail: string
}>

let lastQueryDurationMs: number | null = null
let operationTail: Promise<unknown> = Promise.resolve()
let cachedSemanticIndex: Awaited<ReturnType<typeof readLocalSemanticIndex>> | null = null

function notifyUpdated(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCAL_SEMANTIC_INDEX_UPDATED))
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const scheduled = operationTail.catch(() => undefined).then(operation)
  operationTail = scheduled
  return scheduled
}

function boundedText(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim()
  return compact.length <= LOCAL_SEMANTIC_MAX_INPUT_CHARS
    ? compact
    : compact.slice(0, LOCAL_SEMANTIC_MAX_INPUT_CHARS)
}

export function localSemanticPassage(document: LocalSearchIndexDocument): string {
  const fields = document.fields.map((field) => `${field.label}: ${field.value}`).join("\n")
  return boundedText(`passage: ${document.label}\n${fields}`)
}

function sourceFingerprint(documents: readonly LocalSearchIndexDocument[]): string {
  return [...documents]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((document) => `${document.key}\u0000${document.sourceVersion ?? ""}`)
    .join("\u0001")
}

function dot(left: Float32Array, right: Float32Array): number {
  let score = 0
  for (let index = 0; index < LOCAL_SEMANTIC_VECTOR_DIMENSIONS; index += 1) {
    score += left[index] * right[index]
  }
  return score
}

export function localSemanticScores(
  documents: readonly LocalSearchIndexDocument[],
  vectors: readonly LocalSemanticVector[],
  queryVector: Float32Array,
): ReadonlyMap<string, number> {
  if (queryVector.length !== LOCAL_SEMANTIC_VECTOR_DIMENSIONS) return new Map()
  const documentsByKey = new Map(documents.map((document) => [document.key, document]))
  const scores = new Map<string, number>()
  for (const vector of vectors) {
    const document = documentsByKey.get(vector.documentKey)
    if (
      !document ||
      vector.modelId !== LOCAL_SEMANTIC_MODEL_ID ||
      vector.sourceVersion !== document.sourceVersion
    ) {
      continue
    }
    scores.set(document.key, dot(vector.vector, queryVector))
  }
  return scores
}

export type LocalSemanticLexicalRank = Readonly<{
  documentKey: string
  group: LocalSearchIndexDocument["group"]
  titleMatch: boolean
}>

const SEARCH_GROUPS: readonly LocalSearchIndexDocument["group"][] = [
  "文件",
  "关注",
  "书签",
  "资源",
  "对话",
]

/** Reciprocal-rank fusion：标题优先、正文其次，语义只补充并为同项加权。 */
export function mergeLocalSemanticRanks(
  documents: readonly LocalSearchIndexDocument[],
  lexical: readonly LocalSemanticLexicalRank[],
  semanticScores: ReadonlyMap<string, number>,
  limitPerGroup?: number,
): string[] {
  const limit = limitPerGroup == null ? Number.POSITIVE_INFINITY : Math.max(0, limitPerGroup)
  const sourceOrder = new Map(documents.map((document, index) => [document.key, index]))
  const result: string[] = []
  for (const group of SEARCH_GROUPS) {
    const candidates = new Map<
      string,
      { score: number; lexicalRank: number; sourceOrder: number }
    >()
    lexical
      .filter((item) => item.group === group)
      .forEach((item, rank) => {
        candidates.set(item.documentKey, {
          score: (item.titleMatch ? 3 : 1.5) / (10 + rank),
          lexicalRank: rank,
          sourceOrder: sourceOrder.get(item.documentKey) ?? Number.POSITIVE_INFINITY,
        })
      })
    documents
      .filter((document) => document.group === group && semanticScores.has(document.key))
      .sort(
        (left, right) =>
          (semanticScores.get(right.key) ?? Number.NEGATIVE_INFINITY) -
          (semanticScores.get(left.key) ?? Number.NEGATIVE_INFINITY),
      )
      .forEach((document, rank) => {
        const existing = candidates.get(document.key)
        if (existing) existing.score += 1 / (10 + rank)
        else {
          candidates.set(document.key, {
            score: 1 / (10 + rank),
            lexicalRank: Number.POSITIVE_INFINITY,
            sourceOrder: sourceOrder.get(document.key) ?? Number.POSITIVE_INFINITY,
          })
        }
      })
    result.push(
      ...[...candidates]
        .sort(
          ([, left], [, right]) =>
            right.score - left.score ||
            left.lexicalRank - right.lexicalRank ||
            left.sourceOrder - right.sourceOrder,
        )
        .slice(0, limit)
        .map(([key]) => key),
    )
  }
  return result
}

export function localSemanticIndexMatchesDocuments(
  documents: readonly LocalSearchIndexDocument[],
  vectors: readonly LocalSemanticVector[],
): boolean {
  if (documents.length !== vectors.length) return false
  const documentsByKey = new Map(documents.map((document) => [document.key, document]))
  const vectorKeys = new Set(vectors.map((vector) => vector.documentKey))
  return (
    vectorKeys.size === documents.length &&
    vectors.every((vector) => {
      const document = documentsByKey.get(vector.documentKey)
      return (
        document !== undefined &&
        vector.modelId === LOCAL_SEMANTIC_MODEL_ID &&
        vector.sourceVersion === document.sourceVersion
      )
    })
  )
}

export async function getLocalSemanticSearchStatus(): Promise<LocalSemanticSearchStatus> {
  const [model, index, lexical] = await Promise.all([
    getLocalSemanticModelStatus(),
    readLocalSemanticIndex(),
    readLocalSearchIndex(),
  ])
  const indexReady =
    lexical.ready &&
    index.ready &&
    index.modelId === LOCAL_SEMANTIC_MODEL_ID &&
    localSemanticIndexMatchesDocuments(lexical.documents, index.vectors)
  return {
    available: model.available && typeof Worker !== "undefined",
    enabled: isLocalSemanticSearchEnabled(),
    modelReady: model.ready,
    modelBytes: model.cachedBytes,
    modelExpectedBytes: model.expectedBytes,
    indexReady,
    documentCount: indexReady ? index.vectors.length : 0,
    indexBytes: indexReady
      ? index.vectors.length * LOCAL_SEMANTIC_VECTOR_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT
      : 0,
    rebuiltAt: indexReady ? index.rebuiltAt : null,
    lastQueryDurationMs,
  }
}

async function rebuildNow(
  onProgress?: (progress: LocalSemanticBuildProgress) => void,
): Promise<LocalSemanticSearchStatus> {
  const model = await getLocalSemanticModelStatus()
  if (!model.ready) throw new Error("请先下载本地语义模型")
  const lexical = await readLocalSearchIndex()
  if (!lexical.ready) throw new Error("全文索引尚未就绪")
  if (lexical.documents.length > MAX_LOCAL_SEMANTIC_DOCUMENTS) {
    throw new Error(`语义索引最多支持 ${MAX_LOCAL_SEMANTIC_DOCUMENTS} 个对象`)
  }
  const fingerprint = sourceFingerprint(lexical.documents)
  const vectors: LocalSemanticVector[] = []
  for (let offset = 0; offset < lexical.documents.length; offset += LOCAL_SEMANTIC_MAX_BATCH_SIZE) {
    const batch = lexical.documents.slice(offset, offset + LOCAL_SEMANTIC_MAX_BATCH_SIZE)
    const embedded = await embedLocalSemanticTexts(batch.map(localSemanticPassage))
    for (let index = 0; index < batch.length; index += 1) {
      vectors.push(
        createLocalSemanticVector(
          batch[index].key,
          batch[index].sourceVersion,
          LOCAL_SEMANTIC_MODEL_ID,
          embedded[index],
        ),
      )
    }
    onProgress?.({
      phase: "index",
      progress: lexical.documents.length
        ? Math.min(1, (offset + batch.length) / lexical.documents.length)
        : 1,
      detail: `正在生成向量 ${Math.min(offset + batch.length, lexical.documents.length)}/${lexical.documents.length}`,
    })
  }
  const after = await readLocalSearchIndex()
  if (!after.ready || sourceFingerprint(after.documents) !== fingerprint) {
    throw new Error("构建期间源索引发生变化，请重试")
  }
  await replaceLocalSemanticIndex(LOCAL_SEMANTIC_MODEL_ID, vectors)
  cachedSemanticIndex = null
  if (!setLocalSemanticSearchEnabled(true)) throw new Error("无法保存本地语义检索设置")
  notifyUpdated()
  return getLocalSemanticSearchStatus()
}

export function rebuildLocalSemanticSearch(
  onProgress?: (progress: LocalSemanticBuildProgress) => void,
): Promise<LocalSemanticSearchStatus> {
  return enqueue(() => rebuildNow(onProgress))
}

export function installLocalSemanticSearch(
  onProgress?: (progress: LocalSemanticBuildProgress) => void,
): Promise<LocalSemanticSearchStatus> {
  return enqueue(async () => {
    await downloadLocalSemanticModel((progress: LocalSemanticModelProgress) =>
      onProgress?.({
        phase: "download",
        progress: progress.progress,
        detail: `正在下载 ${progress.file}`,
      }),
    )
    return rebuildNow(onProgress)
  })
}

export async function setLocalSemanticSearchActive(
  enabled: boolean,
): Promise<LocalSemanticSearchStatus> {
  if (enabled) {
    const status = await getLocalSemanticSearchStatus()
    if (!status.modelReady || !status.indexReady) throw new Error("本地语义模型或索引尚未就绪")
  }
  if (!setLocalSemanticSearchEnabled(enabled)) throw new Error("无法保存本地语义检索设置")
  notifyUpdated()
  return getLocalSemanticSearchStatus()
}

export function deleteLocalSemanticSearch(): Promise<LocalSemanticSearchStatus> {
  return enqueue(async () => {
    setLocalSemanticSearchEnabled(false)
    terminateLocalSemanticWorker()
    await Promise.all([deleteLocalSemanticModel(), clearLocalSemanticIndex()])
    cachedSemanticIndex = null
    notifyUpdated()
    return getLocalSemanticSearchStatus()
  })
}

async function refreshDocumentNow(
  document: LocalSearchIndexDocument | null,
  deletedDocumentKey?: string,
): Promise<void> {
  if (!isLocalSemanticSearchEnabled()) return
  try {
    const [model, index] = await Promise.all([
      getLocalSemanticModelStatus(),
      readLocalSemanticIndex(),
    ])
    if (!model.ready || !index.ready || index.modelId !== LOCAL_SEMANTIC_MODEL_ID) return
    if (!document) {
      if (deletedDocumentKey) await deleteLocalSemanticVector(deletedDocumentKey)
    } else {
      const [vector] = await embedLocalSemanticTexts([localSemanticPassage(document)])
      await putLocalSemanticVector(
        createLocalSemanticVector(
          document.key,
          document.sourceVersion,
          LOCAL_SEMANTIC_MODEL_ID,
          vector,
        ),
      )
    }
    cachedSemanticIndex = null
    notifyUpdated()
  } catch {
    // 旧向量不能在更新失败后继续伪装成完整索引；全文检索仍可用。
    await clearLocalSemanticIndex().catch(() => {})
    cachedSemanticIndex = null
    notifyUpdated()
  }
}

export function refreshLocalSemanticDocument(
  document: LocalSearchIndexDocument | null,
  deletedDocumentKey?: string,
): Promise<void> {
  return enqueue(() => refreshDocumentNow(document, deletedDocumentKey))
}

export function invalidateLocalSemanticSearch(): Promise<void> {
  return enqueue(async () => {
    await clearLocalSemanticIndex()
    cachedSemanticIndex = null
    notifyUpdated()
  })
}

export async function queryLocalSemanticScores(
  query: string,
  documents: readonly LocalSearchIndexDocument[],
): Promise<ReadonlyMap<string, number>> {
  if (!isLocalSemanticSearchEnabled() || !query.trim()) return new Map()
  const startedAt = performance.now()
  try {
    const priorCache = cachedSemanticIndex
    let [model, index] = await Promise.all([
      getLocalSemanticModelStatus(),
      priorCache ? Promise.resolve(priorCache) : readLocalSemanticIndex(),
    ])
    cachedSemanticIndex = index
    if (
      priorCache &&
      (!index.ready ||
        index.modelId !== LOCAL_SEMANTIC_MODEL_ID ||
        !localSemanticIndexMatchesDocuments(documents, index.vectors))
    ) {
      index = await readLocalSemanticIndex()
      cachedSemanticIndex = index
    }
    if (
      !model.ready ||
      !index.ready ||
      index.modelId !== LOCAL_SEMANTIC_MODEL_ID ||
      !localSemanticIndexMatchesDocuments(documents, index.vectors)
    ) {
      return new Map()
    }
    const [queryVector] = await embedLocalSemanticTexts([boundedText(`query: ${query.trim()}`)])
    return localSemanticScores(documents, index.vectors, queryVector)
  } finally {
    lastQueryDurationMs = performance.now() - startedAt
    notifyUpdated()
  }
}

export const LOCAL_SEMANTIC_RESOURCE_BUDGET = {
  maxDocuments: MAX_LOCAL_SEMANTIC_DOCUMENTS,
  maxIndexBytes: MAX_LOCAL_SEMANTIC_INDEX_BYTES,
} as const

export { LOCAL_SEMANTIC_INDEX_UPDATED }
