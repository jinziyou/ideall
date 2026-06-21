// MCP-over-postMessage 传输 —— 把一个 MessagePort 包成 MCP SDK 的 Transport。
// 宿主与被嵌入页两侧共用同一实现 (见 docs/ideall-embed-bridge.md §4.2)。
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"

export class MessagePortTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void
  onclose?: () => void
  onerror?: (error: Error) => void
  sessionId?: string

  constructor(private readonly port: MessagePort) {}

  async start(): Promise<void> {
    this.port.onmessage = (e: MessageEvent) => this.onmessage?.(e.data as JSONRPCMessage)
    this.port.onmessageerror = () => this.onerror?.(new Error("messageerror"))
    this.port.start()
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.port.postMessage(message)
  }

  async close(): Promise<void> {
    this.port.close()
    this.onclose?.()
  }
}
