// AI 助手的模型接入设置 —— 本地优先。API Key 走 secure-store;
// 桌面 App 用系统凭据后端, Web 形态降级到命名 fallback。key 不进公开配置,
// 发送时随请求带 Authorization 头直连厂商端点
// (不经服务端代理; App 经 Tauri HTTP 插件绕 CORS, 见 agent-chat.ts)。
// 默认 DeepSeek (OpenAI 兼容); 改 baseURL / model 即可切到 OpenAI、本地 vLLM 等兼容端点。

import {
  SECURE_STORE_KEYS,
  secureDelete,
  secureFallbackGet,
  secureGet,
  secureSet,
} from "@/lib/secure-store"
import { isTauri } from "@/lib/tauri"

export const AGENT_SETTINGS_STORAGE_KEY = "wonita:agent:settings"
const API_KEY_SECURE_KEY = SECURE_STORE_KEYS.AGENT_SETTINGS_API_KEY

export interface AgentSettings {
  /** OpenAI 兼容 API base (不含 /chat/completions) */
  baseURL: string
  /** 模型名 */
  model: string
  /** 用户的 API Key (仅存本地) */
  apiKey: string
  /** 是否把 home 数据 (关注/书签/资源) 作上下文一并发送 */
  includeHomeContext: boolean
  /** 工具调用审批默认策略: confirm=逐次确认 (默认, 安全); auto=自动允许已授权工具。 */
  approvalPolicy: "confirm" | "auto"
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
  approvalPolicy: "confirm",
}

export function isConfigured(s: AgentSettings): boolean {
  return Boolean(s.apiKey.trim() && s.baseURL.trim() && s.model.trim())
}

// useSyncExternalStore 要求 getSnapshot 引用稳定 —— 缓存原始串与解析结果, 内容不变则返回同一引用。
let lastRaw: string | null = null
let lastParsed: AgentSettings = DEFAULT_SETTINGS
let cachedApiKey = ""
let secureHydrated = false
let secureHydrating: Promise<AgentSettings> | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

function parseSettings(raw: string | null): AgentSettings {
  if (!raw) return DEFAULT_SETTINGS
  try {
    const parsed = JSON.parse(raw) as Partial<AgentSettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function publicSettings(next: AgentSettings): Omit<AgentSettings, "apiKey"> & { apiKey?: string } {
  const { apiKey: _apiKey, ...rest } = next
  return rest
}

function persistSettings(next: AgentSettings): void {
  try {
    storage()?.setItem(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify(publicSettings(next)))
  } catch {
    /* 隐私模式 / 存储受限时忽略写入 */
  }
}

export function getAgentSettings(): AgentSettings {
  const s = storage()
  if (!s) return DEFAULT_SETTINGS
  let raw: string | null = null
  try {
    raw = s.getItem(AGENT_SETTINGS_STORAGE_KEY)
  } catch {
    return DEFAULT_SETTINGS
  }
  if (raw === lastRaw) {
    if (!secureHydrated) void hydrateAgentSettingsSecure()
    return lastParsed
  }
  lastRaw = raw
  if (!raw) {
    cachedApiKey = secureFallbackGet(API_KEY_SECURE_KEY) ?? cachedApiKey
    lastParsed = { ...DEFAULT_SETTINGS, apiKey: cachedApiKey }
    if (!secureHydrated) void hydrateAgentSettingsSecure()
    return lastParsed
  }
  const parsed = parseSettings(raw)
  const secureFallback = secureFallbackGet(API_KEY_SECURE_KEY)
  if (secureFallback) {
    cachedApiKey = secureFallback
  } else if (!isTauri() && parsed.apiKey) {
    cachedApiKey = parsed.apiKey
  }
  lastParsed = { ...parsed, apiKey: cachedApiKey }
  if (!secureHydrated) void hydrateAgentSettingsSecure()
  return lastParsed
}

export function setAgentSettings(next: AgentSettings): void {
  cachedApiKey = next.apiKey
  lastParsed = { ...next }
  lastRaw = null
  persistSettings(next)
  if (next.apiKey) void secureSet(API_KEY_SECURE_KEY, next.apiKey)
  else void secureDelete(API_KEY_SECURE_KEY)
  notify()
}

export function subscribeAgentSettings(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export async function hydrateAgentSettingsSecure(): Promise<AgentSettings> {
  if (secureHydrating) return secureHydrating
  secureHydrating = (async () => {
    const s = storage()
    const raw = s?.getItem(AGENT_SETTINGS_STORAGE_KEY) ?? null
    const parsed = parseSettings(raw)
    const secureKey = await secureGet(API_KEY_SECURE_KEY)
    if (secureKey) {
      cachedApiKey = secureKey
    } else if (!isTauri() && parsed.apiKey) {
      cachedApiKey = parsed.apiKey
      await secureSet(API_KEY_SECURE_KEY, parsed.apiKey)
    }
    const next = { ...parsed, apiKey: cachedApiKey }
    persistSettings(next)
    lastRaw = null
    lastParsed = next
    secureHydrated = true
    notify()
    return next
  })().finally(() => {
    secureHydrating = null
  })
  return secureHydrating
}

export function agentSettingsSecuritySnapshot(): {
  key: string
  localApiKeyPresent: boolean
  secureHydrated: boolean
} {
  const raw = storage()?.getItem(AGENT_SETTINGS_STORAGE_KEY) ?? null
  return {
    key: API_KEY_SECURE_KEY,
    localApiKeyPresent: Boolean(parseSettings(raw).apiKey),
    secureHydrated,
  }
}
