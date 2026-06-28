#!/usr/bin/env node
// ACP 暴露方向自测客户端 —— 经 TCP 连到 ideall 的 loopback 监听端口, 跑 initialize→session/new→prompt,
// 收集更新直到 stop, 把结果以单行 JSON 打到 stdout 供 ideall 解析。日志走 stderr。
//
// 用法: node scripts/acp-selftest-client.mjs --port <PORT>
// 由 ideall「暴露自测」按钮经 acp_run_once 拉起 (端口 = 当前 loopback 监听端口)。
import net from "node:net"
import { Duplex } from "node:stream"
import * as acp from "@agentclientprotocol/sdk"

const log = (...a) => console.error("[selftest-client]", ...a)
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n")

const i = process.argv.indexOf("--port")
const port = i >= 0 ? Number(process.argv[i + 1]) : NaN
if (!Number.isFinite(port)) {
  emit({ ok: false, error: "no-port" })
  process.exit(1)
}

let sock
try {
  sock = net.connect(port, "127.0.0.1")
  await new Promise((resolve, reject) => {
    sock.once("connect", resolve)
    sock.once("error", reject)
  })
} catch (e) {
  emit({ ok: false, error: "connect-failed: " + (e && e.message ? e.message : String(e)) })
  process.exit(1)
}
log("connected 127.0.0.1:" + port)

const { readable, writable } = Duplex.toWeb(sock)
const stream = acp.ndJsonStream(writable, readable)

try {
  const out = await acp
    .client({ name: "ideall-selftest" })
    .onRequest(acp.methods.client.session.requestPermission, () => ({
      outcome: { outcome: "cancelled" },
    }))
    .connectWith(stream, async (cx) => {
      const init = await cx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      return cx.buildSession(process.cwd()).withSession(async (s) => {
        let updates = 0
        let text = ""
        s.prompt("ping from ideall expose self-test").catch(() => {})
        for (;;) {
          const m = await s.nextUpdate()
          if (m.kind === "stop") {
            return {
              protocolVersion: init.protocolVersion,
              updates,
              stopReason: m.stopReason,
              text,
            }
          }
          updates++
          if (
            m.update.sessionUpdate === "agent_message_chunk" &&
            m.update.content?.type === "text"
          ) {
            text += m.update.content.text
          }
        }
      })
    })
  // 连上 + 握手 + prompt 路由 + 收到 stopReason = 暴露链路通 (即便未配置模型 stopReason 可能是 refusal)。
  emit({ ok: true, ...out })
  process.exit(0)
} catch (e) {
  emit({ ok: false, error: e && e.message ? e.message : String(e) })
  process.exit(1)
} finally {
  sock.destroy()
}
