import type { FileRef } from "@protocol/file-system"
import type { NodeKind } from "@protocol/node"
import { idbGetAll, idbReplaceStores, idbRunTransaction, STORE_LOCAL_SEARCH_INDEX } from "@/lib/idb"

export const LOCAL_SEARCH_INDEX_SCHEMA_VERSION = 1
const STATE_KEY = "state"
const DOCUMENT_KEY_PREFIX = "document:"

export type LocalSearchIndexGroup = "文件" | "关注" | "书签" | "资源" | "对话" | "连接器"

export type LocalSearchIndexField = Readonly<{
  label: string
  value: string
}>

export type LocalSearchIndexDocument = Readonly<{
  key: string
  type: "document"
  target: FileRef
  group: LocalSearchIndexGroup
  kind: Extract<NodeKind, "note" | "feed" | "bookmark" | "file" | "thread">
  label: string
  fileType?: Readonly<{ name: string; type: string }>
  fields: readonly LocalSearchIndexField[]
  sourceVersion: string | null
  indexedAt: number
}>

type LocalSearchIndexState = Readonly<{
  key: typeof STATE_KEY
  type: "state"
  schemaVersion: number
  rebuiltAt: number
  documentCount: number
}>

export type LocalSearchIndexSnapshot = Readonly<{
  ready: boolean
  rebuiltAt: number | null
  documents: LocalSearchIndexDocument[]
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isState(value: unknown): value is LocalSearchIndexState {
  return (
    isRecord(value) &&
    value.key === STATE_KEY &&
    value.type === "state" &&
    value.schemaVersion === LOCAL_SEARCH_INDEX_SCHEMA_VERSION &&
    typeof value.rebuiltAt === "number" &&
    typeof value.documentCount === "number"
  )
}

function isDocument(value: unknown): value is LocalSearchIndexDocument {
  if (!isRecord(value) || value.type !== "document" || typeof value.key !== "string") return false
  const target = value.target
  const fields = value.fields
  const fileType = value.fileType
  return (
    value.key.startsWith(DOCUMENT_KEY_PREFIX) &&
    isRecord(target) &&
    typeof target.fileSystemId === "string" &&
    target.fileSystemId.length > 0 &&
    typeof target.fileId === "string" &&
    target.fileId.length > 0 &&
    ["文件", "关注", "书签", "资源", "对话", "连接器"].includes(String(value.group)) &&
    ["note", "feed", "bookmark", "file", "thread"].includes(String(value.kind)) &&
    typeof value.label === "string" &&
    Array.isArray(fields) &&
    fields.every(
      (field) =>
        isRecord(field) && typeof field.label === "string" && typeof field.value === "string",
    ) &&
    (fileType === undefined ||
      (isRecord(fileType) &&
        typeof fileType.name === "string" &&
        typeof fileType.type === "string")) &&
    (value.sourceVersion === null || typeof value.sourceVersion === "string") &&
    typeof value.indexedAt === "number"
  )
}

export function localSearchIndexDocumentKey(target: FileRef): string {
  return `${DOCUMENT_KEY_PREFIX}${encodeURIComponent(target.fileSystemId)}:${encodeURIComponent(target.fileId)}`
}

export async function readLocalSearchIndex(): Promise<LocalSearchIndexSnapshot> {
  const rows = await idbGetAll<unknown>(STORE_LOCAL_SEARCH_INDEX)
  const state = rows.find(isState)
  if (!state) return { ready: false, rebuiltAt: null, documents: [] }
  const documents = rows.filter(isDocument)
  if (documents.length !== state.documentCount) {
    return { ready: false, rebuiltAt: state.rebuiltAt, documents: [] }
  }
  return { ready: true, rebuiltAt: state.rebuiltAt, documents }
}

export async function replaceLocalSearchIndex(
  documents: readonly LocalSearchIndexDocument[],
): Promise<void> {
  const rebuiltAt = Date.now()
  const state: LocalSearchIndexState = {
    key: STATE_KEY,
    type: "state",
    schemaVersion: LOCAL_SEARCH_INDEX_SCHEMA_VERSION,
    rebuiltAt,
    documentCount: documents.length,
  }
  await idbReplaceStores(
    [STORE_LOCAL_SEARCH_INDEX],
    [state, ...documents].map((value) => ({ store: STORE_LOCAL_SEARCH_INDEX, value })),
  )
}

export async function putLocalSearchIndexDocument(
  document: LocalSearchIndexDocument,
): Promise<void> {
  await idbRunTransaction<void>(
    [STORE_LOCAL_SEARCH_INDEX],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_LOCAL_SEARCH_INDEX)
      const stateRequest = store.get(STATE_KEY)
      stateRequest.onerror = () => abort(stateRequest.error ?? new Error("读取搜索索引状态失败"))
      stateRequest.onsuccess = () => {
        const state = stateRequest.result as unknown
        if (!isState(state)) {
          abort(new Error("本地搜索索引尚未就绪"))
          return
        }
        const documentRequest = store.get(document.key)
        documentRequest.onerror = () =>
          abort(documentRequest.error ?? new Error("读取搜索索引文档失败"))
        documentRequest.onsuccess = () => {
          const existed = isDocument(documentRequest.result)
          store.put(document)
          if (!existed) store.put({ ...state, documentCount: state.documentCount + 1 })
          setResult()
        }
      }
    },
  )
}

export async function deleteLocalSearchIndexDocument(target: FileRef): Promise<void> {
  const key = localSearchIndexDocumentKey(target)
  await idbRunTransaction<void>(
    [STORE_LOCAL_SEARCH_INDEX],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_LOCAL_SEARCH_INDEX)
      const stateRequest = store.get(STATE_KEY)
      stateRequest.onerror = () => abort(stateRequest.error ?? new Error("读取搜索索引状态失败"))
      stateRequest.onsuccess = () => {
        const state = stateRequest.result as unknown
        if (!isState(state)) {
          setResult()
          return
        }
        const documentRequest = store.get(key)
        documentRequest.onerror = () =>
          abort(documentRequest.error ?? new Error("读取搜索索引文档失败"))
        documentRequest.onsuccess = () => {
          if (isDocument(documentRequest.result)) {
            store.delete(key)
            store.put({ ...state, documentCount: Math.max(0, state.documentCount - 1) })
          }
          setResult()
        }
      }
    },
  )
}
