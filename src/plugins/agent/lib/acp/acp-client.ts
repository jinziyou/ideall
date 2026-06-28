// ACP 客户端方向驱动 (Stage 1, 方案 C) —— 用官方 SDK @agentclientprotocol/sdk 驱动【外部】ACP 智能体
// (如 Claude Code 经 claude-code-acp、Gemini CLI 的 --acp、Codex 等)。
//
// 传输: 经 @/lib/acp-transport 把 Rust 哑管道适配为 SDK 的 message-level Stream; 子进程由 Rust spawn (仅桌面)。
// 用法: 用 SDK 的 fluent API client({}).onRequest(...).connectWith(stream, op) (类版 ClientSideConnection 已 @deprecated)。
//       一轮 = active.prompt(text) + 循环 active.nextUpdate() 直到 kind:"stop" (即 SDK 官方 example 的回合模式)。
// 安全: 不向外部智能体开放本机文件系统 (clientCapabilities.fs=false 且不注册 fs 处理器); 权限请求默认拒绝,
//       由调用方 (UI) 提供 requestPermission 决策。program/args/cwd 来自用户设置, 非模型可控。
//
// 注: 这是「反向驱动外部智能体」方向。另一方向「把 ideall 经 ACP 暴露给编辑器」已实现于 acp-expose.ts
// (Rust 监听器 → createServerStream → exposeIdeallAcpAgent, 由 boot 自启动); 真机端到端验证随 UI 接线推进。
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  PromptResponse,
} from "@agentclientprotocol/sdk"
import { acpSpawn, acpClose, createAcpStream } from "@/lib/acp-transport"
import { PromptQueue } from "../prompt-queue"

export interface ExternalAcpOptions {
  /** 外部 ACP 智能体可执行命令 (用户设置, 非模型可控)。 */
  program: string
  /** 命令参数 (如 ["--acp"])。 */
  args?: string[]
  /** 会话工作目录 (绝对路径; ACP session/new 必需)。 */
  cwd: string
  /** 每条 session/update 通知回调 (展示流式输出 / 工具调用 / 计划)。 */
  onUpdate?: (n: SessionNotification) => void
  /** 一轮 prompt 结束 (stop) 回调。 */
  onTurnEnd?: (r: PromptResponse) => void
  /** 外部智能体请求权限时的决策; 缺省一律拒绝 (cancelled)。 */
  requestPermission?: (req: RequestPermissionRequest) => Promise<RequestPermissionResponse>
}

export interface ExternalAcpHandle {
  /** 入队一条用户提示 (各轮异步串行执行)。 */
  prompt: (text: string) => void
  /** 取消当前进行中的一轮 (session/cancel 通知)。 */
  cancel: () => void
  /** 结束会话并杀子进程; resolve 于连接关闭。 */
  close: () => Promise<void>
  /** 连接关闭时 resolve (子进程退出 / 出错 / close 触发); 始终 resolve, 不抛。 */
  readonly done: Promise<void>
}

/** 连接并驱动一个外部 ACP 智能体; 返回交互句柄。仅 App 桌面可用 (acpSpawn 在非 Tauri 抛)。 */
export async function connectExternalAcpAgent(
  opts: ExternalAcpOptions,
): Promise<ExternalAcpHandle> {
  const acp = await import("@agentclientprotocol/sdk")
  const id = `acp-${crypto.randomUUID()}`

  await acpSpawn(id, opts.program, opts.args ?? [], opts.cwd)
  const { stream, dispose } = await createAcpStream(id)

  const queue = new PromptQueue()
  // 在 op 作用域内捕获 ctx/active 后赋值, 供句柄的 cancel() 跨作用域调用。
  let cancelTurn: (() => void) | null = null

  const running = acp
    .client({ name: "ideall" })
    .onRequest(acp.methods.client.session.requestPermission, (ctx) =>
      opts.requestPermission
        ? opts.requestPermission(ctx.params)
        : ({ outcome: { outcome: "cancelled" } } satisfies RequestPermissionResponse),
    )
    .connectWith(stream, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        // 不向外部智能体开放本机文件系统 (MVP 安全默认; 需要时再显式开放并实现 fs 处理器)。
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      })
      await ctx.buildSession(opts.cwd).withSession(async (active) => {
        cancelTurn = () => {
          void ctx
            .notify(acp.methods.agent.session.cancel, { sessionId: active.sessionId })
            .catch(() => {})
        }
        for (;;) {
          const text = await queue.next()
          if (text === null) return // close() 已调用 → 结束 op → 关连接
          // 发起一轮; prompt 的错误经连接关闭使 nextUpdate 抛出体现, 故仅 catch 防 unhandled rejection。
          active.prompt(text).catch(() => {})
          for (;;) {
            const msg = await active.nextUpdate()
            if (msg.kind === "stop") {
              opts.onTurnEnd?.(msg.response)
              break
            }
            opts.onUpdate?.(msg.notification)
          }
        }
      })
    })

  // 连接收束 (正常/出错/close) 后清理监听与子进程; settled 始终 resolve 供句柄消费。
  const settled = running
    .finally(() => {
      dispose()
      void acpClose(id).catch(() => {})
    })
    .then(
      () => {},
      () => {},
    )

  return {
    prompt: (text) => queue.push(text),
    cancel: () => cancelTurn?.(),
    close: async () => {
      queue.close()
      await acpClose(id).catch(() => {})
      await settled
    },
    done: settled,
  }
}
