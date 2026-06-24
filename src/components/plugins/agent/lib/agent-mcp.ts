// agent ↔ 统一能力层桥 (§6.4): agent 经 LoopbackTransport 消费与 iframe 同一条 Grant→createHubMcpServer 链路。
// 用 agentGrant 起只挂 fs.*/ui.* (无 fs.notes:read) 的 MCP server, 进程内 MessageChannel 接 MCP client;
// tools/list → OpenAI function 工具数组; callTool → 统一调用面 (含隐私/权限 gate, 与 iframe 完全一致)。
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { createHubMcpServer } from "@/components/embed/hub-mcp-server"
import { agentGrant } from "@/components/embed/grant"
import { createLoopbackTransports } from "@/components/embed/transport"
import { getUiActions } from "@/components/lib/ui-actions"

/** OpenAI function-calling 工具定义 (传给模型的 tools 数组)。 */
export type OpenAiTool = {
  type: "function"
  function: { name: string; description?: string; parameters: unknown }
}

export interface AgentMcp {
  /** 由 MCP tools/list 转出的 OpenAI 工具数组 (随授权位变化)。 */
  tools: OpenAiTool[]
  /** 调一个工具; 收敛为 {ok, data} (协议/传输错另抛, 应用级 isError 不抛, 同 callToolSafe 语义)。 */
  callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; data: unknown }>
  /** 断开并释放 (loopback 端口)。 */
  close(): Promise<void>
}

/** 起一条 agent 的 loopback MCP 会话: server(agentGrant) ↔ client, 列出工具备用。 */
export async function connectAgentMcp(): Promise<AgentMcp> {
  const ui = getUiActions()
  const server = createHubMcpServer(agentGrant(Date.now()), {
    navigate: () => {}, // agent 不做内部路由跳转
    openTab: ui ? (kind, id, title) => ui.openTab(kind, id, title) : undefined,
    closeTab: ui ? (kind, id) => ui.closeTab(kind, id) : undefined,
  })
  const { serverTransport, clientTransport } = createLoopbackTransports()
  await server.connect(serverTransport)
  const client = new Client({ name: "ideall-agent", version: "1.0.0" }, { capabilities: {} })
  await client.connect(clientTransport)

  const listed = await client.listTools()
  const tools: OpenAiTool[] = listed.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema ?? { type: "object", properties: {} },
    },
  }))

  return {
    tools,
    async callTool(name, args) {
      const res = await client.callTool({ name, arguments: args })
      const content = res.content as { type?: string; text?: string }[] | undefined
      const text = content?.[0]?.type === "text" ? (content[0].text ?? "") : ""
      let data: unknown = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { raw: text }
      }
      // 应用级 fail() 的 isError:true 不抛 (协议透传), 由 agent 把 ok:false 喂回模型。
      return { ok: res.isError !== true, data }
    },
    async close() {
      try {
        await client.close()
      } catch {
        /* 忽略关连接异常 */
      }
      try {
        await server.close()
      } catch {
        /* 忽略 */
      }
    },
  }
}

const KIND_LABEL: Record<string, string> = {
  note: "笔记",
  bookmark: "书签",
  folder: "收藏夹",
  file: "文件",
  feed: "订阅",
  thread: "对话",
}
function nodeLabel(d: Record<string, unknown> | undefined): string {
  const kind = typeof d?.kind === "string" ? (KIND_LABEL[d.kind] ?? d.kind) : ""
  const title = typeof d?.title === "string" ? d.title : ""
  return title ? `${kind}「${title}」` : kind || "节点"
}

/** 把工具调用结果映射为中文一句话 (供 toolEvents 展示; 否则退化成原始 JSON, §6.4 退化点)。 */
export function summarizeTool(name: string, ok: boolean, data: unknown): string {
  if (!ok) {
    const msg = (data as { message?: string })?.message
    return `操作失败：${name}${msg ? `（${msg}）` : ""}`
  }
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>
  switch (name) {
    case "fs.list":
      return `已列出 ${Array.isArray(data) ? data.length : "若干"} 个项目`
    case "fs.read":
      return `已读取 ${nodeLabel(d)}`
    case "fs.readBlob":
      return "已读取文件内容"
    case "fs.create":
      return `已创建 ${nodeLabel(d)}`
    case "fs.write":
      return `已更新 ${nodeLabel(d)}`
    case "fs.move":
      return `已移动 ${nodeLabel(d)}`
    case "fs.delete":
      return "已删除"
    case "ui.openTab":
      return "已打开标签"
    case "ui.closeTab":
      return "已关闭标签"
    case "host.toast":
      return "已提示"
    default:
      return `已执行 ${name}`
  }
}
