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

/**
 * 回环传输对 (LoopbackTransport, §6.4) —— 本进程内用 MessageChannel 接通 MCP server 与 client 两端。
 * agent 与 iframe 共用 createHubMcpServer + MessagePortTransport, 仅此处把 iframe 的 postMessage 换成
 * 进程内 MessageChannel: agent 起 server.connect(serverTransport) + client.connect(clientTransport)。
 */
export function createLoopbackTransports(): {
  serverTransport: MessagePortTransport
  clientTransport: MessagePortTransport
} {
  const channel = new MessageChannel()
  return {
    serverTransport: new MessagePortTransport(channel.port1),
    clientTransport: new MessagePortTransport(channel.port2),
  }
}
