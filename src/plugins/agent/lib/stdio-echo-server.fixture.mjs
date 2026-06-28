// 测试夹具: 一个真实的 stdio MCP server (NDJSON over stdin/stdout), 暴露 echo 工具。
// 由 agent-mcp-stdio.test.ts spawn (`node <此文件>`), 用于端到端验证 StdioMcpTransport。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const server = new McpServer({ name: "stdio-echo", version: "1.0.0" })
server.tool("echo", { text: z.string() }, async ({ text }) => ({
  content: [{ type: "text", text: JSON.stringify({ echoed: text }) }],
}))
await server.connect(new StdioServerTransport())
