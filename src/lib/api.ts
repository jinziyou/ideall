/**
 * 统一 fetch 封装, 供同构数据访问函数 (App 客户端直连后端 / `pnpm dev` SSR 渲染共用) 使用。
 *
 * 约定所有取数函数返回 `ApiResult<T>`:
 *   - `ok: true` 时, `data` 为响应体; 200/204 空 body 时为 `null` (parseJsonSafe 如实返回)
 *   - `ok: false` 时, `message` 为可展示给用户的错误描述
 *
 * 客户端只需检查 `ok` 字段, 失败时直接 `toast.error(result.message)`。
 *
 * App (Tauri) 形态经 `resolveFetch()` 用 tauri-plugin-http 绕过 webview CORS (后端只放行 wonita.link
 * Origin, App webview 的 `tauri://localhost` 等 Origin 会被挡); 纯浏览器 / SSR 用标准 fetch。
 */
import { resolveFetch } from "@/lib/tauri"

export type ApiResult<T> =
  { ok: true; data: T | null } | { ok: false; message: string; status?: number }

export interface ApiFetchOptions extends RequestInit {
  defaultErrorMessage?: string
  json?: unknown
  /** 在 JSON.parse 前限制响应体 UTF-8 字节数；大响应优先流式计数。 */
  maxResponseBytes?: number
}

export async function apiFetch<T = unknown>(
  input: string,
  options: ApiFetchOptions = {},
): Promise<ApiResult<T>> {
  const {
    defaultErrorMessage = "请求失败, 请稍后重试",
    json,
    maxResponseBytes,
    headers,
    ...rest
  } = options

  const init: RequestInit = {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  }

  let response: Response
  try {
    const httpFetch = await resolveFetch()
    response = await httpFetch(input, init)
  } catch (e) {
    console.error("[apiFetch] network error:", input, e)
    return {
      ok: false,
      message:
        e instanceof Error && e.message ? `网络错误: ${e.message}` : "无法连接到服务器，请检查网络",
    }
  }

  let rawText: string
  try {
    rawText = await readResponseText(response, maxResponseBytes)
  } catch (e) {
    // body 流中断 / abort / 解码错误: 也要返回可展示错误, 不让 reject 逃逸成 unhandled rejection。
    console.error("[apiFetch] 读取响应体失败:", input, e)
    return {
      ok: false,
      status: response.status,
      message: e instanceof ResponseTooLargeError ? e.message : defaultErrorMessage,
    }
  }
  const parsed = parseJsonSafe(rawText)

  if (!response.ok) {
    const message = extractErrorMessage(parsed) ?? rawText?.slice(0, 300) ?? defaultErrorMessage
    return { ok: false, status: response.status, message: message || defaultErrorMessage }
  }

  if (parsed === __PARSE_FAILED) {
    return { ok: false, status: response.status, message: "数据加载失败，请重试" }
  }

  return { ok: true, data: parsed as T }
}

class ResponseTooLargeError extends Error {
  override name = "ResponseTooLargeError"
}

async function readResponseText(response: Response, maximum?: number): Promise<string> {
  if (maximum === undefined) return response.text()
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new TypeError("maxResponseBytes must be a non-negative safe integer")
  }
  const declared = Number(response.headers?.get("content-length"))
  if (Number.isFinite(declared) && declared > maximum) {
    throw new ResponseTooLargeError(`响应数据超过客户端限制（最大 ${maximum} 字节）`)
  }
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maximum) {
      throw new ResponseTooLargeError(`响应数据超过客户端限制（最大 ${maximum} 字节）`)
    }
    return text
  }
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maximum) {
      await reader.cancel().catch(() => {})
      throw new ResponseTooLargeError(`响应数据超过客户端限制（最大 ${maximum} 字节）`)
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

const __PARSE_FAILED = Symbol("parse-failed")

function parseJsonSafe(text: string): unknown | typeof __PARSE_FAILED {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return __PARSE_FAILED
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (body === __PARSE_FAILED || body == null) return undefined
  if (typeof body === "string") return body
  if (typeof body !== "object") return undefined
  const record = body as Record<string, unknown>
  for (const key of ["detail", "message", "error"]) {
    const value = record[key]
    if (typeof value === "string" && value) return value
  }
  // wonita 的统一错误包络：{ error: { code, message } }。
  const nestedError = record.error
  if (nestedError && typeof nestedError === "object") {
    const message = (nestedError as Record<string, unknown>).message
    if (typeof message === "string" && message) return message
  }
  return undefined
}
