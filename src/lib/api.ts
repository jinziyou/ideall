/**
 * 统一 fetch 封装, 供 Server Actions 使用。
 *
 * 约定所有 action 返回 `ApiResult<T>`:
 *   - `ok: true` 时, `data` 为响应体; 200/204 空 body 时为 `null` (parseJsonSafe 如实返回)
 *   - `ok: false` 时, `message` 为可展示给用户的错误描述
 *
 * 客户端只需检查 `ok` 字段, 失败时直接 `toast.error(result.message)`。
 */

export type ApiResult<T> =
  | { ok: true; data: T | null }
  | { ok: false; message: string; status?: number }

export interface ApiFetchOptions extends RequestInit {
  defaultErrorMessage?: string
  json?: unknown
}

export async function apiFetch<T = unknown>(
  input: string,
  options: ApiFetchOptions = {},
): Promise<ApiResult<T>> {
  const { defaultErrorMessage = "请求失败, 请稍后重试", json, headers, ...rest } = options

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
    response = await fetch(input, init)
  } catch (e) {
    console.error("[apiFetch] network error:", input, e)
    return {
      ok: false,
      message:
        e instanceof Error && e.message ? `网络错误: ${e.message}` : "网络错误, 无法连接到服务",
    }
  }

  const rawText = await response.text()
  const parsed = parseJsonSafe(rawText)

  if (!response.ok) {
    const message = extractErrorMessage(parsed) ?? rawText?.slice(0, 300) ?? defaultErrorMessage
    return { ok: false, status: response.status, message: message || defaultErrorMessage }
  }

  if (parsed === __PARSE_FAILED) {
    return { ok: false, status: response.status, message: "响应格式错误, 无法解析" }
  }

  return { ok: true, data: parsed as T }
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
  return undefined
}
