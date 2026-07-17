export const LOCAL_SEMANTIC_MODEL_ID = "Xenova/multilingual-e5-small"
export const LOCAL_SEMANTIC_MODEL_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78"
export const LOCAL_SEMANTIC_MODEL_DTYPE = "q8"
export const LOCAL_SEMANTIC_MODEL_LICENSE = "MIT"
export const LOCAL_SEMANTIC_MODEL_CACHE = "ideall:semantic-model:v1"
export const LOCAL_SEMANTIC_VECTOR_DIMENSIONS = 384
export const LOCAL_SEMANTIC_MAX_INPUT_CHARS = 4_096
export const LOCAL_SEMANTIC_MAX_BATCH_SIZE = 8
export const LOCAL_SEMANTIC_WORKER_PATH = "/generated/semantic-worker.js"
export const LOCAL_SEMANTIC_RUNTIME_PATH = "/generated/semantic-runtime.js"
export const LOCAL_SEMANTIC_INDEX_UPDATED = "ideall:local-semantic-index-updated"
export const LOCAL_SEMANTIC_WASM_FACTORY_PATH = "/generated/ort-wasm-simd-threaded.mjs"
export const LOCAL_SEMANTIC_WASM_BINARY_PATH = "/generated/ort-wasm-simd-threaded.wasm"

export type LocalSemanticWorkerRequest = Readonly<{
  id: number
  type: "embed"
  texts: readonly string[]
}>

export type LocalSemanticWorkerSuccess = Readonly<{
  id: number
  ok: true
  count: number
  dimensions: typeof LOCAL_SEMANTIC_VECTOR_DIMENSIONS
  buffer: ArrayBuffer
}>

export type LocalSemanticWorkerFailure = Readonly<{
  id: number
  ok: false
  error: string
}>

export type LocalSemanticWorkerResponse = LocalSemanticWorkerSuccess | LocalSemanticWorkerFailure
