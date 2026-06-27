// MCP server 注册表 (唯一真源) —— 连接器/外部数据与工具。
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

const store = createCollection<McpServer>("ideall:agent:mcp:v1", seed, migrate)

// 内置 loopback 行由 seed() 注入 (空存储时); getter 保持纯 (勿在 getSnapshot 内 commit)。
export const subscribeMcpServers = store.subscribe
export const getMcpServers = store.get
export const getServerMcpServers = store.getServer
export const getMcpServer = store.byId

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

/** 展示用运行状态: loopback 启用即「已连接」; 外部行传输未落地 → 「待接入」/「已禁用」。 */
export function runStatusOf(s: McpServer): McpRunStatus {
  if (!s.enabled) return "disabled"
  if (s.transport === "loopback") return "connected"
  return "pending"
}
