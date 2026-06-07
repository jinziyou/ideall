// AI 助手对话代理 —— myos 自身的极薄转发路由 (绕开浏览器对厂商 API 的 CORS 限制)。
//
// 本地优先: 用户的 API Key 只存其浏览器, 按请求经此路由携带 (Authorization 头),
// 这里不读取、不持久化任何密钥, 仅把请求与 OpenAI 兼容的流式响应原样转发。
// 数据流向: 浏览器 → 本节点(此路由) → 用户指定的模型厂商 (用户自己的 key)。

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface ChatBody {
  baseURL?: string
  model?: string
  messages?: unknown[]
  /** OpenAI function-calling 工具定义 (智能体模式) */
  tools?: unknown[]
  /** 是否流式; 默认 true。智能体模式的工具轮用 false。 */
  stream?: boolean
}

function bad(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? ""
  const apiKey = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""
  if (!apiKey) return bad("缺少 API Key，请先在设置中填写", 401)

  let body: ChatBody
  try {
    body = (await req.json()) as ChatBody
  } catch {
    return bad("请求体解析失败", 400)
  }

  const baseURL = (body.baseURL ?? "").trim().replace(/\/+$/, "")
  const model = (body.model ?? "").trim()
  const messages = body.messages
  if (!baseURL || !/^https?:\/\//i.test(baseURL)) return bad("模型 baseURL 无效", 400)
  // 本地优先: 刻意允许 localhost / 私网 (用户指向自建的本地模型, 如 Ollama)。
  // 但云厂商元数据端点无任何合法用途且会泄露 IAM 凭证, 精准封堵。
  try {
    const host = new URL(baseURL).hostname.replace(/^\[|\]$/g, "").toLowerCase()
    if (
      host === "169.254.169.254" ||
      host === "metadata.google.internal" ||
      host === "fd00:ec2::254"
    ) {
      return bad("禁止访问云元数据端点", 400)
    }
  } catch {
    return bad("模型 baseURL 无效", 400)
  }
  if (!model) return bad("未指定模型", 400)
  if (!Array.isArray(messages) || messages.length === 0) return bad("消息为空", 400)

  const stream = body.stream !== false
  const tools = Array.isArray(body.tools) && body.tools.length ? body.tools : undefined

  let upstream: Response
  try {
    upstream = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      // tool_choice 不显式发 —— 有 tools 时各家默认即 "auto", 省略可避免个别端点不识别该字段。
      body: JSON.stringify({
        model,
        messages,
        stream,
        ...(tools ? { tools } : {}),
      }),
    })
  } catch (e) {
    return bad(`无法连接模型服务: ${e instanceof Error ? e.message : String(e)}`, 502)
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "")
    let message = text
    try {
      message = JSON.parse(text)?.error?.message ?? text
    } catch {
      /* 非 JSON 错误原样返回 */
    }
    return bad(message || `模型服务返回 ${upstream.status}`, upstream.status || 502)
  }

  // 非流式 (工具轮): 原样回传上游 JSON, 客户端读 choices[0].message(.tool_calls)。
  if (!stream) {
    const data = await upstream.json().catch(() => null)
    if (data === null) return bad("模型服务返回了无法解析的响应", 502)
    return Response.json(data, { headers: { "Cache-Control": "no-store" } })
  }

  // 流式: 原样透传上游的 SSE 流 (OpenAI chat.completion.chunk 格式), 客户端逐块解析。
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}
