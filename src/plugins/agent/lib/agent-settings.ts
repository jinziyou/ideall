// AI 智能体的模型接入设置 —— 本地优先。API Key 走 secure-store;
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
import {
  DEFAULT_AGENT_SETTINGS_DOCUMENT,
  PROVIDER_PRESETS,
  type AgentSettingsDocument,
} from "../agent-settings-file-contract"

export { PROVIDER_PRESETS } from "../agent-settings-file-contract"

export const AGENT_SETTINGS_STORAGE_KEY = "ideall:agent:settings"
export const LEGACY_AGENT_SETTINGS_STORAGE_KEY = "wonita:agent:settings"
/** 仅记录成功凭据 mutation 次数；不包含、派生或暴露任何 API Key 内容。 */
export const AGENT_SETTINGS_CREDENTIAL_REVISION_STORAGE_KEY =
  "ideall:agent:settings:credential-revision"
const API_KEY_SECURE_KEY = SECURE_STORE_KEYS.AGENT_SETTINGS_API_KEY
const CREDENTIAL_REVISION_PATTERN = /^(0|[1-9]\d{0,63})$/

export interface AgentSettings extends AgentSettingsDocument {
  /** 用户的 API Key (仅存本地) */
  apiKey: string
}

export const DEFAULT_SETTINGS: AgentSettings = {
  ...DEFAULT_AGENT_SETTINGS_DOCUMENT,
  apiKey: "",
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
let credentialMutationTail: Promise<void> = Promise.resolve()
let volatileCredentialRevision = 0n
const listeners = new Set<() => void>()

function notify() {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // 单个 Display/adapter 的订阅错误不能把已经持久化的凭据误报为写入失败。
    }
  }
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

function readCredentialRevision(): bigint {
  let raw: string | null = null
  try {
    raw = storage()?.getItem(AGENT_SETTINGS_CREDENTIAL_REVISION_STORAGE_KEY) ?? null
  } catch {
    return volatileCredentialRevision
  }
  if (!raw || !CREDENTIAL_REVISION_PATTERN.test(raw)) return volatileCredentialRevision
  const persisted = BigInt(raw)
  if (persisted > volatileCredentialRevision) volatileCredentialRevision = persisted
  return volatileCredentialRevision
}

function advanceCredentialRevision(): string {
  const next = readCredentialRevision() + 1n
  volatileCredentialRevision = next
  try {
    storage()?.setItem(AGENT_SETTINGS_CREDENTIAL_REVISION_STORAGE_KEY, String(next))
  } catch {
    // 无可用 public storage 时仍保持当前进程单调；secure-store 已提交，不能反转成功结果。
  }
  return String(next)
}

/** FileSystem version 使用的不透明单调值；缺失旧数据兼容为当前进程基线。 */
export function agentSettingsCredentialRevisionSnapshot(): string {
  return String(readCredentialRevision())
}

function readPublicSettingsRaw(s: Storage): string | null {
  const raw = s.getItem(AGENT_SETTINGS_STORAGE_KEY)
  const legacy = s.getItem(LEGACY_AGENT_SETTINGS_STORAGE_KEY)
  if (raw !== null) {
    if (legacy !== null) s.removeItem(LEGACY_AGENT_SETTINGS_STORAGE_KEY)
    return raw
  }
  if (legacy !== null) {
    s.setItem(AGENT_SETTINGS_STORAGE_KEY, legacy)
    s.removeItem(LEGACY_AGENT_SETTINGS_STORAGE_KEY)
    return legacy
  }
  return null
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

function sameObservableSettings(left: AgentSettings, right: AgentSettings): boolean {
  return (
    left.baseURL === right.baseURL &&
    left.model === right.model &&
    left.apiKey === right.apiKey &&
    left.includeHomeContext === right.includeHomeContext &&
    left.defaultAgentMode === right.defaultAgentMode &&
    left.approvalPolicy === right.approvalPolicy
  )
}

function persistSettings(next: AgentSettings): void {
  try {
    const s = storage()
    s?.setItem(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify(publicSettings(next)))
    s?.removeItem(LEGACY_AGENT_SETTINGS_STORAGE_KEY)
  } catch {
    /* 隐私模式 / 存储受限时忽略写入 */
  }
}

export function getAgentSettings(): AgentSettings {
  const s = storage()
  if (!s) return DEFAULT_SETTINGS
  let raw: string | null = null
  try {
    raw = readPublicSettingsRaw(s)
  } catch {
    return DEFAULT_SETTINGS
  }
  if (raw === lastRaw) {
    if (!secureHydrated) void hydrateAgentSettingsSecure()
    return lastParsed
  }
  lastRaw = raw
  if (!raw) {
    cachedApiKey = (isTauri() ? null : secureFallbackGet(API_KEY_SECURE_KEY)) ?? cachedApiKey
    lastParsed = { ...DEFAULT_SETTINGS, apiKey: cachedApiKey }
    if (!secureHydrated) void hydrateAgentSettingsSecure()
    return lastParsed
  }
  const parsed = parseSettings(raw)
  const secureFallback = isTauri() ? null : secureFallbackGet(API_KEY_SECURE_KEY)
  if (secureFallback) {
    cachedApiKey = secureFallback
  } else if (!isTauri() && parsed.apiKey) {
    cachedApiKey = parsed.apiKey
  }
  lastParsed = { ...parsed, apiKey: cachedApiKey }
  if (!secureHydrated) void hydrateAgentSettingsSecure()
  return lastParsed
}

export function setAgentSettings(next: AgentSettings): Promise<void> {
  return persistAgentSettings(next)
}

/**
 * 仅用于已经完成 secure-store 事务的适配器：提交公开设置与内存快照，但不再启动
 * fire-and-forget 凭据写。调用方必须保证 next.apiKey 与已持久化状态一致。
 */
function commitAgentSettingsAfterSecurePersistence(next: AgentSettings): void {
  cachedApiKey = next.apiKey
  lastParsed = { ...next }
  lastRaw = null
  persistSettings(next)
  notify()
}

/** Store 级耐久原语；复合 UI 必须经 agent-settings-write-adapter 取得 FileRef 写锁。 */
export function persistAgentSettings(next: AgentSettings): Promise<void> {
  return enqueueCredentialMutation(async () => {
    await hydrateAgentSettingsSecure()
    if (next.apiKey) await secureSet(API_KEY_SECURE_KEY, next.apiKey)
    else await secureDelete(API_KEY_SECURE_KEY)
    advanceCredentialRevision()
    commitAgentSettingsAfterSecurePersistence(next)
  })
}

/** 公开文件写事务：解析、必要的凭据清除与公开快照提交在同一凭据队列内完成。 */
export function replaceAgentSettingsPublicDurably(
  resolveNext: (current: AgentSettings) => AgentSettings,
): Promise<void> {
  return enqueueCredentialMutation(async () => {
    const current = await hydrateAgentSettingsSecure()
    const next = resolveNext(current)
    if (current.apiKey && !next.apiKey) {
      await secureDelete(API_KEY_SECURE_KEY)
      advanceCredentialRevision()
    }
    commitAgentSettingsAfterSecurePersistence(next)
  })
}

export function subscribeAgentSettings(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 只返回是否存在凭据；供 FileSystem version/watch 使用，不暴露值。 */
export function isAgentSettingsCredentialConfigured(): boolean {
  return Boolean(
    (cachedApiKey || (isTauri() ? null : secureFallbackGet(API_KEY_SECURE_KEY)) || "").trim(),
  )
}

function commitCredential(apiKey: string): void {
  const s = storage()
  let raw: string | null = null
  try {
    raw = s ? readPublicSettingsRaw(s) : null
  } catch {
    raw = null
  }
  cachedApiKey = apiKey
  lastRaw = raw
  lastParsed = { ...parseSettings(raw), apiKey }
  secureHydrated = true
  notify()
}

function enqueueCredentialMutation(operation: () => Promise<void>): Promise<void> {
  const pending = credentialMutationTail.then(operation, operation)
  credentialMutationTail = pending.then(
    () => undefined,
    () => undefined,
  )
  return pending
}

/** FileSystem credential action 的持久化边界；完成后才通知 watch 订阅者。 */
export function setAgentSettingsApiKey(apiKey: string): Promise<void> {
  return enqueueCredentialMutation(async () => {
    await hydrateAgentSettingsSecure()
    await secureSet(API_KEY_SECURE_KEY, apiKey)
    advanceCredentialRevision()
    commitCredential(apiKey)
  })
}

export function clearAgentSettingsApiKey(): Promise<void> {
  return enqueueCredentialMutation(async () => {
    await hydrateAgentSettingsSecure()
    await secureDelete(API_KEY_SECURE_KEY)
    advanceCredentialRevision()
    commitCredential("")
  })
}

export async function hydrateAgentSettingsSecure(): Promise<AgentSettings> {
  if (secureHydrating) return secureHydrating
  if (secureHydrated) {
    // Public settings may have changed through the storage event path, but the secure credential
    // cache is already authoritative for this process. Refresh that public projection without
    // touching secure-store or publishing another watch invalidation.
    getAgentSettings()
    return lastParsed
  }
  secureHydrating = (async () => {
    const previous = lastParsed
    const previousRevision = agentSettingsCredentialRevisionSnapshot()
    const s = storage()
    const raw = s ? readPublicSettingsRaw(s) : null
    const parsed = parseSettings(raw)
    const secureKey = await secureGet(API_KEY_SECURE_KEY)
    if (secureKey) {
      cachedApiKey = secureKey
    } else if (!isTauri() && parsed.apiKey) {
      cachedApiKey = parsed.apiKey
      await secureSet(API_KEY_SECURE_KEY, parsed.apiKey)
      advanceCredentialRevision()
    }
    const next = { ...parsed, apiKey: cachedApiKey }
    persistSettings(next)
    lastRaw = null
    lastParsed = next
    secureHydrated = true
    if (
      !sameObservableSettings(previous, next) ||
      previousRevision !== agentSettingsCredentialRevisionSnapshot()
    ) {
      notify()
    }
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
  const s = storage()
  const raw = s ? readPublicSettingsRaw(s) : null
  return {
    key: API_KEY_SECURE_KEY,
    localApiKeyPresent: Boolean(parseSettings(raw).apiKey),
    secureHydrated,
  }
}
