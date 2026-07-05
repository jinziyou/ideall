// 本机密钥表 —— 配置里用 ${NAME} 占位引用密钥, 避免把明文 secret 内嵌进 server 配置 (便于分享/导出配置而不泄漏)。
// 密钥本体写 secure-store: 桌面 App 走系统凭据后端, Web 形态降级到命名 fallback。
// localStorage 中的索引只保留密钥名, 不再保留 value。
// 纯 store + subscribe/get (复用 agent-collection)。

import { secureDelete, secureFallbackGet, secureGet, secureSet } from "@/lib/secure-store"
import { isTauri } from "@/lib/tauri"
import { createCollection } from "./agent-collection"

/** 一条密钥 (id = 密钥名, 供 ${NAME} 引用)。 */
export interface Secret {
  id: string
  value: string
  secure?: boolean
}

export const AGENT_SECRETS_STORAGE_KEY = "ideall:agent:secrets:v1"
const store = createCollection<Secret>(AGENT_SECRETS_STORAGE_KEY)
const secretCache = new Map<string, string>()
let hydrated = false
let hydrating: Promise<void> | null = null

function secureKey(id: string): string {
  return `ideall:agent:secret:${id}`
}

function materialized(secret: Secret): Secret {
  return {
    ...secret,
    value: secretCache.get(secret.id) ?? secureFallbackGet(secureKey(secret.id)) ?? "",
  }
}

export const subscribeSecrets = store.subscribe
export const getSecrets = () => store.get().map(materialized)
export const getServerSecrets = store.getServer

/** 名须与 ${NAME} 解析正则一致 (字母/数字/下划线), 否则存了也引用不到。 */
export function isValidSecretName(name: string): boolean {
  return /^\w+$/.test(name.trim())
}

export function setSecret(name: string, value: string): void {
  const id = name.trim()
  if (!isValidSecretName(id)) return
  secretCache.set(id, value)
  store.upsert({ id, value: "", secure: true })
  void secureSet(secureKey(id), value)
}

export function deleteSecret(name: string): void {
  secretCache.delete(name)
  store.remove(name)
  void secureDelete(secureKey(name))
}

// 安全: 密钥仅在 buildHeaders 解析后发往用户自己配置的 server URL; 当前无配置导入/分享路径,
// 且 loopback 工具 (fs/ui/web) 不能写 MCP 注册表 / 读密钥表, 故模型无法构造外泄 header。
// 将来若加配置导入/分享, 须对 ${NAME} 解析做 host 绑定或用户确认 (防被构造的 server 套出密钥)。
/** 解析文本里的 ${NAME} 占位为密钥值; 未知名原样保留 (便于发现拼写错, 不静默清空)。 */
export function resolveSecrets(text: string): string {
  if (!hydrated) void hydrateAgentSecretsSecure()
  return text.replace(
    /\$\{(\w+)\}/g,
    (m, name: string) =>
      secretCache.get(name) ??
      secureFallbackGet(secureKey(name)) ??
      (isTauri() ? undefined : store.byId(name)?.value) ??
      m,
  )
}

/** 文本是否含 ${NAME} 占位 (UI 据此提示)。 */
export function hasSecretRef(text: string): boolean {
  return /\$\{\w+\}/.test(text)
}

export async function hydrateAgentSecretsSecure(): Promise<void> {
  if (hydrating) return hydrating
  hydrating = (async () => {
    const current = store.get()
    let changed = false
    for (const secret of current) {
      const secureValue = await secureGet(secureKey(secret.id))
      if (secureValue) {
        secretCache.set(secret.id, secureValue)
      } else if (!isTauri() && secret.value) {
        secretCache.set(secret.id, secret.value)
        await secureSet(secureKey(secret.id), secret.value)
      }
      if (secret.value || !secret.secure) changed = true
    }
    if (changed) {
      store.replaceAll(current.map((secret) => ({ id: secret.id, value: "", secure: true })))
    }
    hydrated = true
  })().finally(() => {
    hydrating = null
  })
  return hydrating
}

export function agentSecretsSecuritySnapshot(): {
  total: number
  localValueCount: number
  secureHydrated: boolean
} {
  const secrets = store.get()
  return {
    total: secrets.length,
    localValueCount: secrets.filter((secret) => Boolean(secret.value)).length,
    secureHydrated: hydrated,
  }
}
