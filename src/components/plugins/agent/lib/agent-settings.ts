// AI 助手的模型接入设置 —— 本地优先, 仅存本机浏览器 localStorage。
// 用户自带 API Key: key 不进任何服务端配置, 只在浏览器保存, 发送时按请求经本节点代理转发。
// 默认 DeepSeek (OpenAI 兼容); 改 baseURL / model 即可切到 OpenAI、本地 vLLM 等兼容端点。

const SETTINGS_KEY = "wonita:agent:settings"

export interface AgentSettings {
  /** OpenAI 兼容 API base (不含 /chat/completions) */
  baseURL: string
  /** 模型名 */
  model: string
  /** 用户的 API Key (仅存本地) */
  apiKey: string
  /** 是否把 home 数据 (订阅/书签/资源) 作上下文一并发送 */
  includeHomeContext: boolean
}

/** 常见 OpenAI 兼容端点预设 (仅填 baseURL/model, key 仍需用户自填)。 */
export const PROVIDER_PRESETS: { label: string; baseURL: string; model: string }[] = [
  { label: "DeepSeek", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "本地 vLLM", baseURL: "http://127.0.0.1:8000/v1", model: "" },
]

export const DEFAULT_SETTINGS: AgentSettings = {
  baseURL: PROVIDER_PRESETS[0].baseURL,
  model: PROVIDER_PRESETS[0].model,
  apiKey: "",
  includeHomeContext: true,
}

export function isConfigured(s: AgentSettings): boolean {
  return Boolean(s.apiKey.trim() && s.baseURL.trim() && s.model.trim())
}

// useSyncExternalStore 要求 getSnapshot 引用稳定 —— 缓存原始串与解析结果, 内容不变则返回同一引用。
let lastRaw: string | null = null
let lastParsed: AgentSettings = DEFAULT_SETTINGS
const listeners = new Set<() => void>()

export function getAgentSettings(): AgentSettings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS
  let raw: string | null = null
  try {
    raw = localStorage.getItem(SETTINGS_KEY)
  } catch {
    return DEFAULT_SETTINGS
  }
  if (raw === lastRaw) return lastParsed
  lastRaw = raw
  if (!raw) {
    lastParsed = DEFAULT_SETTINGS
    return lastParsed
  }
  try {
    lastParsed = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AgentSettings>) }
  } catch {
    lastParsed = DEFAULT_SETTINGS
  }
  return lastParsed
}

export function setAgentSettings(next: AgentSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch {
    /* 隐私模式 / 存储受限时忽略写入 */
  }
  listeners.forEach((l) => l())
}

export function subscribeAgentSettings(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
