// 本机密钥表 —— 配置里用 ${NAME} 占位引用密钥, 避免把明文 secret 内嵌进 server 配置 (便于分享/导出配置而不泄漏)。
// 密钥本体仍仅存本机 localStorage (本地优先固有); 与 env/header 的 ${NAME} 占位约定一致 (见 agent-mcp-registry env 注释)。
// 纯 store + subscribe/get (复用 agent-collection)。

import { createCollection } from "./agent-collection"

/** 一条密钥 (id = 密钥名, 供 ${NAME} 引用)。 */
export interface Secret {
  id: string
  value: string
}

const store = createCollection<Secret>("ideall:agent:secrets:v1")

export const subscribeSecrets = store.subscribe
export const getSecrets = store.get
export const getServerSecrets = store.getServer

/** 名须与 ${NAME} 解析正则一致 (字母/数字/下划线), 否则存了也引用不到。 */
export function isValidSecretName(name: string): boolean {
  return /^\w+$/.test(name.trim())
}

export function setSecret(name: string, value: string): void {
  const id = name.trim()
  if (!isValidSecretName(id)) return
  store.upsert({ id, value })
}

export function deleteSecret(name: string): void {
  store.remove(name)
}

// 安全: 密钥仅在 buildHeaders 解析后发往用户自己配置的 server URL; 当前无配置导入/分享路径,
// 且 loopback 工具 (fs/ui/web) 不能写 MCP 注册表 / 读密钥表, 故模型无法构造外泄 header。
// 将来若加配置导入/分享, 须对 ${NAME} 解析做 host 绑定或用户确认 (防被构造的 server 套出密钥)。
/** 解析文本里的 ${NAME} 占位为密钥值; 未知名原样保留 (便于发现拼写错, 不静默清空)。 */
export function resolveSecrets(text: string): string {
  return text.replace(/\$\{(\w+)\}/g, (m, name: string) => store.byId(name)?.value ?? m)
}

/** 文本是否含 ${NAME} 占位 (UI 据此提示)。 */
export function hasSecretRef(text: string): boolean {
  return /\$\{\w+\}/.test(text)
}
