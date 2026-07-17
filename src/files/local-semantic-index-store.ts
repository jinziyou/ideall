import {
  STORE_LOCAL_SEMANTIC_INDEX,
  idbGetAll,
  idbReplaceStores,
  idbRunTransaction,
} from "@/lib/idb"
import { LOCAL_SEMANTIC_VECTOR_DIMENSIONS } from "@/lib/local-semantic-contract"

export { LOCAL_SEMANTIC_VECTOR_DIMENSIONS } from "@/lib/local-semantic-contract"

export const LOCAL_SEMANTIC_INDEX_SCHEMA_VERSION = 1
export const MAX_LOCAL_SEMANTIC_DOCUMENTS = 10_000
export const MAX_LOCAL_SEMANTIC_INDEX_BYTES =
  MAX_LOCAL_SEMANTIC_DOCUMENTS * LOCAL_SEMANTIC_VECTOR_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT

const STATE_KEY = "state"
const VECTOR_KEY_PREFIX = "vector:"

export type LocalSemanticVector = Readonly<{
  key: string
  type: "vector"
  documentKey: string
  sourceVersion: string | null
  modelId: string
  dimensions: typeof LOCAL_SEMANTIC_VECTOR_DIMENSIONS
  vector: Float32Array
  indexedAt: number
}>

type LocalSemanticIndexState = Readonly<{
  key: typeof STATE_KEY
  type: "state"
  schemaVersion: typeof LOCAL_SEMANTIC_INDEX_SCHEMA_VERSION
  modelId: string
  dimensions: typeof LOCAL_SEMANTIC_VECTOR_DIMENSIONS
  rebuiltAt: number
  vectorCount: number
}>

export type LocalSemanticIndexSnapshot = Readonly<{
  ready: boolean
  modelId: string | null
  rebuiltAt: number | null
  vectors: LocalSemanticVector[]
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isState(value: unknown): value is LocalSemanticIndexState {
  return (
    isRecord(value) &&
    value.key === STATE_KEY &&
    value.type === "state" &&
    value.schemaVersion === LOCAL_SEMANTIC_INDEX_SCHEMA_VERSION &&
    typeof value.modelId === "string" &&
    value.modelId.length > 0 &&
    value.dimensions === LOCAL_SEMANTIC_VECTOR_DIMENSIONS &&
    Number.isFinite(value.rebuiltAt) &&
    Number.isSafeInteger(value.vectorCount) &&
    (value.vectorCount as number) >= 0 &&
    (value.vectorCount as number) <= MAX_LOCAL_SEMANTIC_DOCUMENTS
  )
}

function isVector(value: unknown): value is LocalSemanticVector {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    value.key.startsWith(VECTOR_KEY_PREFIX) &&
    value.type === "vector" &&
    typeof value.documentKey === "string" &&
    value.documentKey.length > 0 &&
    (value.sourceVersion === null || typeof value.sourceVersion === "string") &&
    typeof value.modelId === "string" &&
    value.modelId.length > 0 &&
    value.dimensions === LOCAL_SEMANTIC_VECTOR_DIMENSIONS &&
    value.vector instanceof Float32Array &&
    value.vector.length === LOCAL_SEMANTIC_VECTOR_DIMENSIONS &&
    Number.isFinite(value.indexedAt)
  )
}

export function localSemanticVectorKey(documentKey: string): string {
  return `${VECTOR_KEY_PREFIX}${documentKey}`
}

export function createLocalSemanticVector(
  documentKey: string,
  sourceVersion: string | null,
  modelId: string,
  vector: Float32Array,
  indexedAt = Date.now(),
): LocalSemanticVector {
  if (vector.length !== LOCAL_SEMANTIC_VECTOR_DIMENSIONS) {
    throw new TypeError(`Semantic vector must have ${LOCAL_SEMANTIC_VECTOR_DIMENSIONS} dimensions`)
  }
  return {
    key: localSemanticVectorKey(documentKey),
    type: "vector",
    documentKey,
    sourceVersion,
    modelId,
    dimensions: LOCAL_SEMANTIC_VECTOR_DIMENSIONS,
    vector: new Float32Array(vector),
    indexedAt,
  }
}

export async function readLocalSemanticIndex(): Promise<LocalSemanticIndexSnapshot> {
  const rows = await idbGetAll<unknown>(STORE_LOCAL_SEMANTIC_INDEX)
  const state = rows.find(isState)
  if (!state) return { ready: false, modelId: null, rebuiltAt: null, vectors: [] }
  const vectors = rows.filter(isVector)
  const ready =
    vectors.length === state.vectorCount &&
    vectors.every(
      (vector) => vector.modelId === state.modelId && vector.dimensions === state.dimensions,
    )
  return {
    ready,
    modelId: state.modelId,
    rebuiltAt: state.rebuiltAt,
    vectors: ready ? vectors : [],
  }
}

export async function replaceLocalSemanticIndex(
  modelId: string,
  vectors: readonly LocalSemanticVector[],
): Promise<void> {
  if (!modelId || vectors.length > MAX_LOCAL_SEMANTIC_DOCUMENTS) {
    throw new Error("Semantic index exceeds its bounded document budget")
  }
  if (vectors.some((vector) => !isVector(vector) || vector.modelId !== modelId)) {
    throw new TypeError("Semantic index contains an invalid vector")
  }
  const rebuiltAt = Date.now()
  const state: LocalSemanticIndexState = {
    key: STATE_KEY,
    type: "state",
    schemaVersion: LOCAL_SEMANTIC_INDEX_SCHEMA_VERSION,
    modelId,
    dimensions: LOCAL_SEMANTIC_VECTOR_DIMENSIONS,
    rebuiltAt,
    vectorCount: vectors.length,
  }
  await idbReplaceStores(
    [STORE_LOCAL_SEMANTIC_INDEX],
    [state, ...vectors].map((value) => ({ store: STORE_LOCAL_SEMANTIC_INDEX, value })),
  )
}

export async function putLocalSemanticVector(vector: LocalSemanticVector): Promise<void> {
  if (!isVector(vector)) throw new TypeError("Invalid semantic vector")
  await idbRunTransaction<void>(
    [STORE_LOCAL_SEMANTIC_INDEX],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_LOCAL_SEMANTIC_INDEX)
      const stateRequest = store.get(STATE_KEY)
      stateRequest.onerror = () => abort(stateRequest.error)
      stateRequest.onsuccess = () => {
        const state = stateRequest.result as unknown
        if (!isState(state) || state.modelId !== vector.modelId) {
          abort(new Error("Semantic index is not ready for incremental updates"))
          return
        }
        const currentRequest = store.get(vector.key)
        currentRequest.onerror = () => abort(currentRequest.error)
        currentRequest.onsuccess = () => {
          const exists = isVector(currentRequest.result)
          if (!exists && state.vectorCount >= MAX_LOCAL_SEMANTIC_DOCUMENTS) {
            abort(new Error("Semantic index document budget is full"))
            return
          }
          store.put(vector)
          if (!exists) store.put({ ...state, vectorCount: state.vectorCount + 1 })
          setResult()
        }
      }
    },
  )
}

export async function deleteLocalSemanticVector(documentKey: string): Promise<void> {
  const key = localSemanticVectorKey(documentKey)
  await idbRunTransaction<void>(
    [STORE_LOCAL_SEMANTIC_INDEX],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_LOCAL_SEMANTIC_INDEX)
      const stateRequest = store.get(STATE_KEY)
      stateRequest.onerror = () => abort(stateRequest.error)
      stateRequest.onsuccess = () => {
        const state = stateRequest.result as unknown
        if (!isState(state)) {
          setResult()
          return
        }
        const currentRequest = store.get(key)
        currentRequest.onerror = () => abort(currentRequest.error)
        currentRequest.onsuccess = () => {
          if (isVector(currentRequest.result)) {
            store.delete(key)
            store.put({ ...state, vectorCount: Math.max(0, state.vectorCount - 1) })
          }
          setResult()
        }
      }
    },
  )
}

export async function clearLocalSemanticIndex(): Promise<void> {
  await idbReplaceStores([STORE_LOCAL_SEMANTIC_INDEX], [])
}
