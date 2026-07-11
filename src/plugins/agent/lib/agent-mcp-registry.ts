// MCP server 注册表 (唯一数据来源) —— 连接器/外部数据与工具。
// 内置「本地能力 (loopback)」固定一行 (映射 AGENT_PERMISSIONS 工具), 不可删; 其余为用户添加的外部 server。
// 注: 外部传输 (stdio / SSE / Streamable-HTTP) 接缝预留, 实际连接随 ACP 落地 (见 acp-*.ts); 当前外部行仅存配置。
// 本地优先 localStorage; 工作空间按 toolAllowlist 选用其工具 (见 agent-workspace.ts)。

import { genId } from "@/lib/id"
import { createCollection } from "./agent-collection"

export type McpTransport = "loopback" | "stdio" | "sse" | "http"
export type McpRunStatus = "connected" | "connecting" | "error" | "disabled" | "pending"

export const MCP_TRANSPORTS: { value: McpTransport; label: string }[] = [
  { value: "stdio", label: "stdio (本地命令)" },
  { value: "sse", label: "SSE" },
  { value: "http", label: "Streamable HTTP" },
]

export interface McpEnvVar {
  key: string
  value: string
}

export interface McpServer {
  id: string
  name: string
  transport: McpTransport
  /** stdio: 启动命令。 */
  command: string
  /** stdio: 参数 (空白分隔)。 */
  args: string
  /** sse / http: 端点 URL。 */
  url: string
  /** 环境变量 (secret 以 ${NAME} 占位, 不明文)。 */
  env: McpEnvVar[]
  /** sse / http: 请求头 (认证: Authorization: Bearer <token> 等; secret 仅存本机, 值支持 ${NAME} 引用密钥)。 */
  headers: McpEnvVar[]
  /** sse / http 认证方式: none=无/仅请求头; oauth=OAuth 授权码 (token 经 agent-oauth 持久化)。 */
  auth: "none" | "oauth"
  enabled: boolean
  /** 内置 loopback 行 (本地能力), 不可删改传输。 */
  builtin: boolean
  createdAt: number
  updatedAt: number
}

export const LOOPBACK_ID = "mcp-loopback"

function migrate(raw: Partial<McpServer>): McpServer {
  const now = Date.now()
  return {
    id: raw.id ?? genId("mcp"),
    name: raw.name ?? "未命名服务器",
    transport: raw.transport ?? "stdio",
    command: raw.command ?? "",
    args: raw.args ?? "",
    url: raw.url ?? "",
    env: Array.isArray(raw.env) ? raw.env : [],
    headers: Array.isArray(raw.headers) ? raw.headers : [],
    auth: raw.auth === "oauth" ? "oauth" : "none",
    enabled: raw.enabled ?? true,
    builtin: raw.builtin ?? false,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  }
}

function loopbackRow(): McpServer {
  const now = Date.now()
  return {
    id: LOOPBACK_ID,
    name: "本地能力 (loopback)",
    transport: "loopback",
    command: "",
    args: "",
    url: "",
    env: [],
    headers: [],
    auth: "none",
    enabled: true,
    builtin: true,
    createdAt: now,
    updatedAt: now,
  }
}

// 种子始终含内置 loopback 行; 载入时也保证它在 (容旧)。
function seed(): McpServer[] {
  return [loopbackRow()]
}

export const AGENT_MCP_STORAGE_KEY = "ideall:agent:mcp:v1"
const store = createCollection<McpServer>(AGENT_MCP_STORAGE_KEY, seed, migrate)

// 内置 loopback 行由 seed() 注入 (空存储时); getter 保持纯 (勿在 getSnapshot 内 commit)。
export const subscribeMcpServers = store.subscribe
export const getMcpServers = store.get
export const getServerMcpServers = store.getServer

export function createMcpServer(partial?: Partial<McpServer>): McpServer {
  const s = migrate({ ...partial, id: genId("mcp"), builtin: false, createdAt: Date.now() })
  store.upsert(s)
  return s
}

export function saveMcpServer(s: McpServer): void {
  store.upsert({ ...s, updatedAt: Date.now() })
}

export function setMcpEnabled(id: string, enabled: boolean): void {
  const s = store.byId(id)
  if (s) store.upsert({ ...s, enabled, updatedAt: Date.now() })
}

export function deleteMcpServer(id: string): void {
  const s = store.byId(id)
  if (s?.builtin) return // 内置 loopback 不可删
  store.remove(id)
}

/** 用公开配置快照替换注册表，同时守住内置 loopback 的身份与传输约束。 */
export function replaceMcpServers(servers: readonly Partial<McpServer>[]): void {
  const migrated = servers.map(migrate)
  const suppliedLoopback = migrated.find((server) => server.id === LOOPBACK_ID)
  const loopback = suppliedLoopback
    ? {
        ...suppliedLoopback,
        id: LOOPBACK_ID,
        transport: "loopback" as const,
        builtin: true,
      }
    : loopbackRow()
  const external = migrated.filter((server) => server.id !== LOOPBACK_ID && !server.builtin)
  store.replaceAll([loopback, ...external])
}

/** 展示用运行状态: loopback 启用即「已连接」; 外部行传输 (stdio/SSE/streamable-http) 已实现, 但按运行
 *  时连接 (connectAgentMcp 每轮按需连), 无常驻连接可反映 → 静态显示「待接入」; 未启用 → 「已禁用」。 */
export function runStatusOf(s: McpServer): McpRunStatus {
  if (!s.enabled) return "disabled"
  if (s.transport === "loopback") return "connected"
  return "pending"
}
