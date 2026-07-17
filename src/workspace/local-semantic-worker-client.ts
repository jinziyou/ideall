import {
  LOCAL_SEMANTIC_MAX_BATCH_SIZE,
  LOCAL_SEMANTIC_MAX_INPUT_CHARS,
  LOCAL_SEMANTIC_VECTOR_DIMENSIONS,
  LOCAL_SEMANTIC_WORKER_PATH,
  type LocalSemanticWorkerRequest,
  type LocalSemanticWorkerResponse,
} from "@/lib/local-semantic-contract"

const REQUEST_TIMEOUT_MS = 120_000

type PendingRequest = {
  resolve: (vectors: Float32Array[]) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
let nextId = 1
let tail: Promise<unknown> = Promise.resolve()
const pending = new Map<number, PendingRequest>()

function failAll(error: Error): void {
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(error)
  }
  pending.clear()
  worker?.terminate()
  worker = null
}

function getWorker(): Worker {
  if (worker) return worker
  if (typeof Worker === "undefined") throw new Error("当前环境不支持本地语义 Worker")
  worker = new Worker(LOCAL_SEMANTIC_WORKER_PATH, { type: "module", name: "ideall-semantic" })
  worker.onmessage = (event: MessageEvent<LocalSemanticWorkerResponse>) => {
    const response = event.data
    const request = pending.get(response?.id)
    if (!request) return
    pending.delete(response.id)
    clearTimeout(request.timer)
    if (!response.ok) {
      request.reject(new Error(response.error))
      return
    }
    const flat = new Float32Array(response.buffer)
    if (
      response.dimensions !== LOCAL_SEMANTIC_VECTOR_DIMENSIONS ||
      flat.length !== response.count * LOCAL_SEMANTIC_VECTOR_DIMENSIONS
    ) {
      request.reject(new Error("语义 Worker 返回了无效向量"))
      return
    }
    const vectors = Array.from({ length: response.count }, (_, index) =>
      flat.slice(
        index * LOCAL_SEMANTIC_VECTOR_DIMENSIONS,
        (index + 1) * LOCAL_SEMANTIC_VECTOR_DIMENSIONS,
      ),
    )
    request.resolve(vectors)
  }
  worker.onerror = () => failAll(new Error("本地语义 Worker 运行失败"))
  worker.onmessageerror = () => failAll(new Error("本地语义 Worker 返回值无法读取"))
  return worker
}

function send(texts: readonly string[]): Promise<Float32Array[]> {
  if (
    texts.length === 0 ||
    texts.length > LOCAL_SEMANTIC_MAX_BATCH_SIZE ||
    texts.some((text) => !text || text.length > LOCAL_SEMANTIC_MAX_INPUT_CHARS)
  ) {
    return Promise.reject(new TypeError("无效的本地语义批次"))
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error("本地语义计算超时"))
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    const request: LocalSemanticWorkerRequest = { id, type: "embed", texts }
    getWorker().postMessage(request)
  })
}

export function embedLocalSemanticTexts(texts: readonly string[]): Promise<Float32Array[]> {
  const scheduled = tail.catch(() => undefined).then(() => send(texts))
  tail = scheduled
  return scheduled
}

export function terminateLocalSemanticWorker(): void {
  failAll(new Error("本地语义 Worker 已停止"))
  tail = Promise.resolve()
}
