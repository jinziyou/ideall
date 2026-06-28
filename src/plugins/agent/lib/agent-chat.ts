// 客户端流式对话 —— 直接调用用户配置的 OpenAI 兼容端点 (BYO key, 不经服务端代理)。
// 在浏览器 / App webview 运行 (fetch + ReadableStream), 由对话面板调用。
// key 仅存本地、随请求带 Authorization 头, 不上传任何第三方。
// App (Tauri) 经 HTTP 插件 (Rust 侧请求) 绕过 webview CORS, 可直连任意厂商端点;
// 纯浏览器 (web) 直连受厂商 CORS 限制 —— 本地端点 (Ollama 等) 与放行 CORS 的端点可直用。
// CORS 绕过的 fetch 解析与数据层共用 `@/lib/tauri` 的 `resolveFetch()`。
import { resolveFetch } from "@/lib/tauri"

export interface StreamChatOptions {
  baseURL: string
  model: string
  apiKey: string
  messages: { role: string; content: string }[]
  signal?: AbortSignal
  /** 每收到一段增量文本回调一次 */
  onDelta: (text: string) => void
}

export interface ToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface CompletionMessage {
  role: string
  content: string | null
  tool_calls?: ToolCall[]
}

export interface CompletionOptions {
  baseURL: string
  model: string
  apiKey: string
  messages: unknown[]
  tools?: unknown[]
  signal?: AbortSignal
}

/** 拼接 chat/completions 端点 (容忍 baseURL 末尾斜杠)。 */
function chatUrl(baseURL: string): string {
  return `${baseURL.trim().replace(/\/+$/, "")}/chat/completions`
}

/** 解析厂商错误响应 (OpenAI 兼容: `{error:{message}}` 或裸 `{error}`)。 */
async function errorMessage(res: Response): Promise<string> {
  try {
    const j = await res.json()
    const e = j?.error
    if (typeof e === "string") return e
    if (e?.message) return e.message as string
  } catch {
    /* 忽略解析失败 */
  }
  return `请求失败 (${res.status})`
}

/** 发起一次非流式补全 (智能体工具轮用); 返回 assistant 消息 (可能含 tool_calls)。出错抛异常。 */
export async function requestCompletion(opts: CompletionOptions): Promise<CompletionMessage> {
  let res: Response
  const httpFetch = await resolveFetch()
  try {
    res = await httpFetch(chatUrl(opts.baseURL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      // tool_choice 不显式发 —— 有 tools 时各家默认即 "auto", 省略可避免个别端点不识别该字段。
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        ...(Array.isArray(opts.tools) && opts.tools.length ? { tools: opts.tools } : {}),
        stream: false,
      }),
      signal: opts.signal,
    })
  } catch (e) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError")
    throw new Error(`网络错误：${e instanceof Error ? e.message : String(e)}`)
  }
  if (!res.ok) throw new Error(await errorMessage(res))
  const data = await res.json().catch(() => null)
  const msg = data?.choices?.[0]?.message
  if (!msg) throw new Error("模型返回为空")
  return { role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls }
}

/** 发起一次流式补全; 出错抛异常 (含厂商返回的错误消息)。 */
export async function streamChat(opts: StreamChatOptions): Promise<void> {
  let res: Response
  const httpFetch = await resolveFetch()
  try {
    res = await httpFetch(chatUrl(opts.baseURL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true }),
      signal: opts.signal,
    })
  } catch (e) {
    if (opts.signal?.aborted) return
    throw new Error(`网络错误：${e instanceof Error ? e.message : String(e)}`)
  }

  if (!res.ok || !res.body) throw new Error(await errorMessage(res))

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  // 解析一行 SSE; 命中 content 增量则回调。
  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith("data:")) return
    const data = trimmed.slice(5).trim()
    if (!data || data === "[DONE]") return
    try {
      const json = JSON.parse(data)
      const delta = json?.choices?.[0]?.delta?.content
      if (typeof delta === "string" && delta) opts.onDelta(delta)
    } catch {
      /* 跳过无法解析的行 (心跳 / 注释等) */
    }
  }

  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch {
      if (opts.signal?.aborted) return
      throw new Error("读取响应流失败")
    }
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })

    // SSE 事件以空行分隔; 按行解析 data: 前缀
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? "" // 末尾可能是半行, 留到下次
    for (const line of lines) handleLine(line)
  }

  // 收尾: 刷出解码器并处理 buffer 残留的最后一行 (流末尾可能无换行, 否则会丢最后一段)
  buffer += decoder.decode()
  for (const line of buffer.split("\n")) handleLine(line)
}
