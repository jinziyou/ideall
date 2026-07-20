// stdio MCP 传输 —— 把本地命令型 MCP server (program/args/cwd) 适配为 MCP SDK 的 Transport。
// 复用 ACP 的 Rust spawn + NDJSON 行框定桥 (@/lib/acp-transport): 一行 = 一条 JSON-RPC 消息, 与 MCP stdio 规范一致。
// 仅桌面 App 可用 (acpSpawn 非 Tauri 抛 → 由 connectAgentMcp 的 try/catch 跳过)。
// 安全: program/args 来自用户在 MCP 注册表的显式配置 (非模型可控), 与 acp_spawn 的攻击面收口一致。
// spawner 可注入: 生产用 ACP 桥; 测试注入 node 子进程, 验证同一套 NDJSON 收发逻辑。

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { acpClose, acpSpawn, createAcpStream } from "@/lib/acp-transport"
import { isTauri } from "@/lib/tauri"

/** 一条已做 JSON 消息框定的双工管道 (一行 = 一条消息)。 */
export interface StdioPipe {
  readable: ReadableStream<unknown>
  writable: WritableStream<unknown>
  close(): Promise<void>
}

export type StdioSpawner = (program: string, args: string[], cwd?: string) => Promise<StdioPipe>

let seq = 0

/** 默认 spawner: 经 ACP Rust 桥 spawn 子进程 + NDJSON 行框定 (仅桌面)。 */
const acpStdioSpawner: StdioSpawner = async (program, args, cwd) => {
  if (!isTauri()) throw new Error("acp-unavailable: stdio MCP 仅桌面 App 可用")
  const id = `mcp-stdio-${Date.now().toString(36)}-${seq++}`
  const { stream, dispose } = await createAcpStream(id)
  try {
    // 先注册事件监听再 spawn，短命进程的 initialize/错误消息也不会丢失。
    await acpSpawn(id, program, args, cwd)
  } catch (error) {
    dispose()
    await stream.readable.cancel().catch(() => {})
    await acpClose(id).catch(() => {})
    throw error
  }
  return {
    readable: stream.readable as ReadableStream<unknown>,
    writable: stream.writable as WritableStream<unknown>,
    async close() {
      await acpClose(id)
      dispose()
    },
  }
}

/** 本地命令型 MCP server 的 stdio 传输 (NDJSON over spawned process)。 */
export class StdioMcpTransport implements Transport {
  onmessage?: Transport["onmessage"]
  onclose?: Transport["onclose"]
  onerror?: Transport["onerror"]

  private pipe?: StdioPipe
  private reader?: ReadableStreamDefaultReader<unknown>
  private writer?: WritableStreamDefaultWriter<unknown>
  private closed = false

  constructor(
    private readonly opts: { program: string; args: string[]; cwd?: string },
    private readonly spawner: StdioSpawner = acpStdioSpawner,
  ) {}

  async start(): Promise<void> {
    if (this.pipe || this.closed) throw new Error("stdio MCP transport already started")
    const pipe = await this.spawner(this.opts.program, this.opts.args, this.opts.cwd)
    this.pipe = pipe
    this.writer = pipe.writable.getWriter()
    const reader = pipe.readable.getReader()
    this.reader = reader
    // 读循环: 每条消息 → onmessage; 流结束/出错 → onclose。
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          this.onmessage?.(value as JSONRPCMessage)
        }
      } catch (e) {
        if (!this.closed) this.onerror?.(e instanceof Error ? e : new Error(String(e)))
      } finally {
        this.onclose?.()
      }
    })()
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.writer) throw new Error("stdio MCP transport is not ready")
    await this.writer.write(message)
  }

  async close(): Promise<void> {
    this.closed = true
    try {
      await this.writer?.close()
    } catch {
      /* writer 可能已关 */
    }
    try {
      await this.reader?.cancel()
    } catch {
      /* reader 可能已结束 */
    }
    await this.pipe?.close()
  }
}
