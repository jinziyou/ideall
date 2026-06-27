// ACP 传输 (JS 侧) —— 把 Rust「哑管道」适配为官方 SDK (@agentclientprotocol/sdk) 的 message-level Stream。
//
// Rust 侧已做 NDJSON 字节框定 (每条消息一行), 故此处一行 = 一条消息: 读 JSON.parse、写 JSON.stringify。
// 两个方向共用同一套行框定 (makeMessageStream):
//   出站 (客户端方向: 驱动外部 ACP 智能体): acp_spawn 子进程 + acp://message / acp://closed + acp_send。
//   入站 (暴露方向: 编辑器连入):           acp_listen_start 监听 + acp://server/{open,message,closed} + acp_server_send。
// 运行时零依赖 SDK (只引类型, 编译期擦除); 仅 App 桌面可用 (子进程 / 监听器仅桌面注册)。
import type { Stream, AnyMessage } from "@agentclientprotocol/sdk"
import { isTauri } from "@/lib/tauri"

async function invokeCmd<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(cmd, args)
}

// —— 出站 (客户端方向) ——
export function acpSpawn(id: string, program: string, args: string[], cwd?: string): Promise<void> {
  if (!isTauri()) throw new Error("acp-unavailable: ACP 外部智能体仅 App 桌面可用")
  return invokeCmd("acp_spawn", { id, program, args, cwd })
}
export function acpSend(id: string, line: string): Promise<void> {
  return invokeCmd("acp_send", { id, line })
}
export function acpClose(id: string): Promise<void> {
  return invokeCmd("acp_close", { id })
}

// —— 入站 (暴露方向) ——
/** 开始监听 127.0.0.1:port (port 缺省/0 → OS 分配); 返回实际端口。 */
export function acpListenStart(port?: number): Promise<number> {
  if (!isTauri()) throw new Error("acp-unavailable: ACP 入站监听仅 App 桌面可用")
  return invokeCmd("acp_listen_start", { port })
}
export function acpListenStop(): Promise<void> {
  return invokeCmd("acp_listen_stop", {})
}
export function acpServerSend(connId: string, line: string): Promise<void> {
  return invokeCmd("acp_server_send", { id: connId, line })
}
export function acpServerClose(connId: string): Promise<void> {
  return invokeCmd("acp_server_close", { id: connId })
}

/** 监听入站新连接; 非 Tauri 为 no-op。返回取消监听。 */
export async function onAcpServerOpen(cb: (connId: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  return listen<{ connId: string }>("acp://server/open", (e) => cb(e.payload.connId))
}
/** 监听入站连接关闭; 非 Tauri 为 no-op。返回取消监听。 */
export async function onAcpServerClosed(cb: (connId: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  return listen<{ connId: string }>("acp://server/closed", (e) => cb(e.payload.connId))
}

// —— 共用: 把一对 (message 事件 / closed 事件 / send 命令) 包成 SDK message-level Stream ——
// 出站事件载荷键为 id、入站为 connId; 两者都兜 (eid = id ?? connId)。
async function makeMessageStream(opts: {
  id: string
  messageEvent: string
  closedEvent: string
  send: (id: string, line: string) => Promise<void>
}): Promise<{ stream: Stream; dispose: () => void }> {
  const { listen } = await import("@tauri-apps/api/event")
  let unMsg: () => void = () => {}
  let unClosed: () => void = () => {}

  const readable = new ReadableStream<AnyMessage>({
    async start(controller) {
      unMsg = await listen<{ id?: string; connId?: string; line: string }>(
        opts.messageEvent,
        (e) => {
          if ((e.payload.id ?? e.payload.connId) !== opts.id) return
          try {
            controller.enqueue(JSON.parse(e.payload.line) as AnyMessage)
          } catch {
            // 容错: ACP 保证每行合法 JSON。
          }
        },
      )
      unClosed = await listen<{ id?: string; connId?: string }>(opts.closedEvent, (e) => {
        if ((e.payload.id ?? e.payload.connId) !== opts.id) return
        try {
          controller.close()
        } catch {
          // 已关。
        }
      })
    },
    cancel() {
      unMsg()
      unClosed()
    },
  })

  const writable = new WritableStream<AnyMessage>({
    async write(msg) {
      await opts.send(opts.id, JSON.stringify(msg))
    },
  })

  return {
    stream: { readable, writable },
    dispose() {
      unMsg()
      unClosed()
    },
  }
}

/** 出站: 为子进程会话 id 建 Stream。 */
export function createAcpStream(id: string): Promise<{ stream: Stream; dispose: () => void }> {
  return makeMessageStream({
    id,
    messageEvent: "acp://message",
    closedEvent: "acp://closed",
    send: acpSend,
  })
}

/** 入站: 为某入站连接 connId 建 Stream。 */
export function createServerStream(
  connId: string,
): Promise<{ stream: Stream; dispose: () => void }> {
  return makeMessageStream({
    id: connId,
    messageEvent: "acp://server/message",
    closedEvent: "acp://server/closed",
    send: acpServerSend,
  })
}
