import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers"
import {
  LOCAL_SEMANTIC_MAX_BATCH_SIZE,
  LOCAL_SEMANTIC_MAX_INPUT_CHARS,
  LOCAL_SEMANTIC_MODEL_CACHE,
  LOCAL_SEMANTIC_MODEL_DTYPE,
  LOCAL_SEMANTIC_MODEL_ID,
  LOCAL_SEMANTIC_MODEL_REVISION,
  LOCAL_SEMANTIC_VECTOR_DIMENSIONS,
  LOCAL_SEMANTIC_WASM_BINARY_PATH,
  LOCAL_SEMANTIC_WASM_FACTORY_PATH,
  type LocalSemanticWorkerRequest,
  type LocalSemanticWorkerResponse,
} from "@/lib/local-semantic-contract"

type WorkerScope = Readonly<{
  location: Location
  postMessage: (message: LocalSemanticWorkerResponse, transfer?: Transferable[]) => void
}> & {
  onmessage: ((event: MessageEvent<LocalSemanticWorkerRequest>) => void) | null
}

const scope = globalThis as unknown as WorkerScope

env.allowLocalModels = true
env.allowRemoteModels = true
env.useBrowserCache = false
env.useCustomCache = true
env.useWasmCache = false
env.customCache = {
  async match(request) {
    return (await caches.open(LOCAL_SEMANTIC_MODEL_CACHE)).match(request)
  },
  async put() {
    throw new Error("Semantic worker is offline-only")
  },
}
env.fetch = async () => {
  throw new Error("Semantic worker cannot access the network")
}
const wasmBackend = env.backends.onnx.wasm
if (!wasmBackend) throw new Error("Transformers.js WASM backend is unavailable")
wasmBackend.numThreads = 1
wasmBackend.proxy = false
wasmBackend.wasmPaths = {
  mjs: new URL(LOCAL_SEMANTIC_WASM_FACTORY_PATH, scope.location.href).href,
  wasm: new URL(LOCAL_SEMANTIC_WASM_BINARY_PATH, scope.location.href).href,
}

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null

function extractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= pipeline("feature-extraction", LOCAL_SEMANTIC_MODEL_ID, {
    revision: LOCAL_SEMANTIC_MODEL_REVISION,
    dtype: LOCAL_SEMANTIC_MODEL_DTYPE,
    device: "wasm",
    local_files_only: true,
  })
  return extractorPromise
}

function validTexts(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= LOCAL_SEMANTIC_MAX_BATCH_SIZE &&
    value.every(
      (text) =>
        typeof text === "string" &&
        text.length > 0 &&
        text.length <= LOCAL_SEMANTIC_MAX_INPUT_CHARS,
    )
  )
}

scope.onmessage = (event) => {
  const request = event.data
  if (!request || request.type !== "embed" || !Number.isSafeInteger(request.id)) return
  void (async () => {
    try {
      if (!validTexts(request.texts)) throw new Error("Invalid semantic embedding batch")
      const model = await extractor()
      const output = await model([...request.texts], { pooling: "mean", normalize: true })
      try {
        if (
          output.dims.length !== 2 ||
          output.dims[0] !== request.texts.length ||
          output.dims[1] !== LOCAL_SEMANTIC_VECTOR_DIMENSIONS ||
          !(output.data instanceof Float32Array)
        ) {
          throw new Error("Embedding model returned an invalid tensor")
        }
        const vectors = new Float32Array(output.data)
        const response: LocalSemanticWorkerResponse = {
          id: request.id,
          ok: true,
          count: request.texts.length,
          dimensions: LOCAL_SEMANTIC_VECTOR_DIMENSIONS,
          buffer: vectors.buffer,
        }
        scope.postMessage(response, [vectors.buffer])
      } finally {
        output.dispose()
      }
    } catch (error) {
      scope.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })()
}
