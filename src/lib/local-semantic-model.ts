import { resolveFetch } from "./tauri"
import {
  LOCAL_SEMANTIC_MODEL_CACHE,
  LOCAL_SEMANTIC_MODEL_ID,
  LOCAL_SEMANTIC_MODEL_REVISION,
} from "./local-semantic-contract"

export {
  LOCAL_SEMANTIC_MODEL_CACHE,
  LOCAL_SEMANTIC_MODEL_DTYPE,
  LOCAL_SEMANTIC_MODEL_ID,
  LOCAL_SEMANTIC_MODEL_LICENSE,
  LOCAL_SEMANTIC_MODEL_REVISION,
} from "./local-semantic-contract"
export const LOCAL_SEMANTIC_MODEL_MAX_BYTES = 144 * 1024 * 1024

export const LOCAL_SEMANTIC_MODEL_FILES = [
  { path: "config.json", bytes: 658 },
  { path: "onnx/model_quantized.onnx", bytes: 118_308_185 },
  { path: "tokenizer.json", bytes: 17_082_730 },
  { path: "tokenizer_config.json", bytes: 443 },
] as const

export const LOCAL_SEMANTIC_MODEL_DOWNLOAD_BYTES = LOCAL_SEMANTIC_MODEL_FILES.reduce(
  (total, file) => total + file.bytes,
  0,
)

export type LocalSemanticModelStatus = Readonly<{
  available: boolean
  ready: boolean
  cachedFiles: number
  totalFiles: number
  cachedBytes: number
  expectedBytes: number
}>

export type LocalSemanticModelProgress = Readonly<{
  file: string
  loaded: number
  total: number
  progress: number
}>

export function localSemanticModelFileUrl(path: string): string {
  return `https://huggingface.co/${LOCAL_SEMANTIC_MODEL_ID}/resolve/${LOCAL_SEMANTIC_MODEL_REVISION}/${path}`
}

function cacheAvailable(): boolean {
  return typeof caches !== "undefined" && typeof TransformStream !== "undefined"
}

async function cachedFileIsValid(cache: Cache, path: string, bytes: number): Promise<boolean> {
  const response = await cache.match(localSemanticModelFileUrl(path))
  if (!response) return false
  return Number(response.headers.get("content-length")) === bytes
}

export async function getLocalSemanticModelStatus(): Promise<LocalSemanticModelStatus> {
  if (!cacheAvailable()) {
    return {
      available: false,
      ready: false,
      cachedFiles: 0,
      totalFiles: LOCAL_SEMANTIC_MODEL_FILES.length,
      cachedBytes: 0,
      expectedBytes: LOCAL_SEMANTIC_MODEL_DOWNLOAD_BYTES,
    }
  }
  const cache = await caches.open(LOCAL_SEMANTIC_MODEL_CACHE)
  const validity = await Promise.all(
    LOCAL_SEMANTIC_MODEL_FILES.map((file) => cachedFileIsValid(cache, file.path, file.bytes)),
  )
  const cachedBytes = validity.reduce(
    (total, valid, index) => total + (valid ? LOCAL_SEMANTIC_MODEL_FILES[index].bytes : 0),
    0,
  )
  return {
    available: true,
    ready: validity.every(Boolean),
    cachedFiles: validity.filter(Boolean).length,
    totalFiles: LOCAL_SEMANTIC_MODEL_FILES.length,
    cachedBytes,
    expectedBytes: LOCAL_SEMANTIC_MODEL_DOWNLOAD_BYTES,
  }
}

export async function downloadLocalSemanticModel(
  onProgress?: (progress: LocalSemanticModelProgress) => void,
): Promise<LocalSemanticModelStatus> {
  if (!cacheAvailable()) throw new Error("当前环境不支持本地模型缓存")
  const cache = await caches.open(LOCAL_SEMANTIC_MODEL_CACHE)
  const appFetch = await resolveFetch()
  let completedBytes = 0

  for (const file of LOCAL_SEMANTIC_MODEL_FILES) {
    const url = localSemanticModelFileUrl(file.path)
    if (await cachedFileIsValid(cache, file.path, file.bytes)) {
      completedBytes += file.bytes
      onProgress?.({
        file: file.path,
        loaded: completedBytes,
        total: LOCAL_SEMANTIC_MODEL_DOWNLOAD_BYTES,
        progress: completedBytes / LOCAL_SEMANTIC_MODEL_DOWNLOAD_BYTES,
      })
      continue
    }

    await cache.delete(url)
    const response = await appFetch(url, { redirect: "follow" })
    if (!response.ok || !response.body) {
      throw new Error(`模型文件下载失败：${file.path}（HTTP ${response.status}）`)
    }
    const declared = Number(response.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > file.bytes) {
      throw new Error(`模型文件超出固定预算：${file.path}`)
    }

    let fileBytes = 0
    const counted = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          fileBytes += chunk.byteLength
          if (
            fileBytes > file.bytes ||
            completedBytes + fileBytes > LOCAL_SEMANTIC_MODEL_MAX_BYTES
          ) {
            controller.error(new Error(`模型文件超出固定预算：${file.path}`))
            return
          }
          onProgress?.({
            file: file.path,
            loaded: completedBytes + fileBytes,
            total: LOCAL_SEMANTIC_MODEL_DOWNLOAD_BYTES,
            progress: Math.min(
              1,
              (completedBytes + fileBytes) / LOCAL_SEMANTIC_MODEL_DOWNLOAD_BYTES,
            ),
          })
          controller.enqueue(chunk)
        },
      }),
    )
    const headers = new Headers(response.headers)
    headers.set("content-length", String(file.bytes))
    try {
      await cache.put(url, new Response(counted, { status: 200, headers }))
    } catch (error) {
      await cache.delete(url)
      throw error
    }
    if (fileBytes !== file.bytes) {
      await cache.delete(url)
      throw new Error(`模型文件大小不匹配：${file.path}`)
    }
    completedBytes += file.bytes
  }

  const status = await getLocalSemanticModelStatus()
  if (!status.ready) throw new Error("模型缓存校验失败")
  return status
}

export async function deleteLocalSemanticModel(): Promise<void> {
  if (typeof caches !== "undefined") await caches.delete(LOCAL_SEMANTIC_MODEL_CACHE)
}
