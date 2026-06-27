// 端到端回归: stdio MCP (本地命令型 server) 真连接 + 列工具 + callTool。
// 生产用 ACP Rust 桥 spawn (仅桌面); 此处注入 node 子进程 spawner, 验证 StdioMcpTransport 的同一套 NDJSON 收发逻辑
// 真能 spawn 进程、完成 MCP 握手并调用工具。fixture = 真实 SDK stdio MCP server (stdio-echo-server.fixture.mjs)。
import { spawn } from "node:child_process"
import path from "node:path"
import { test } from "node:test"
import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioMcpTransport, type StdioPipe } from "./agent-mcp-stdio"

const FIXTURE = path.resolve("src/plugins/agent/lib/stdio-echo-server.fixture.mjs")

/** 测试 spawner: node 子进程 + NDJSON 行框定 (与生产 ACP 桥同形)。 */
function nodeStdioSpawner(program: string, args: string[], cwd?: string): Promise<StdioPipe> {
  const cp = spawn(program, args, { cwd, stdio: ["pipe", "pipe", "inherit"] })
  const readable = new ReadableStream<unknown>({
    start(controller) {
      let buf = ""
      cp.stdout?.on("data", (d: Buffer) => {
        buf += d.toString()
        let nl: number
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          if (line.trim()) {
            try {
              controller.enqueue(JSON.parse(line))
            } catch {
              /* 跳过非 JSON 行 */
            }
          }
        }
      })
      cp.on("exit", () => {
        try {
          controller.close()
        } catch {
          /* 已关 */
        }
      })
    },
  })
  const writable = new WritableStream<unknown>({
    write(msg) {
      cp.stdin?.write(JSON.stringify(msg) + "\n")
    },
  })
  return Promise.resolve({
    readable,
    writable,
    async close() {
      cp.kill()
    },
  })
}

test("stdio MCP 端到端: spawn 本地命令型 server → 握手 + 列工具 + callTool", async () => {
  const transport = new StdioMcpTransport({ program: "node", args: [FIXTURE] }, nodeStdioSpawner)
  const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} })
  await client.connect(transport)
  try {
    const listed = await client.listTools()
    assert.ok(
      listed.tools.some((t) => t.name === "echo"),
      "应列出 stdio server 暴露的 echo 工具",
    )
    const res = await client.callTool({ name: "echo", arguments: { text: "hi" } })
    const content = res.content as { type: string; text: string }[]
    assert.deepEqual(
      JSON.parse(content[0].text),
      { echoed: "hi" },
      "应拿到 stdio server 的真实返回",
    )
  } finally {
    await client.close()
    await transport.close()
  }
})
