// L1 能力层工厂 —— transport 无关 (本地数据提供方设计 §2/§7, 见 docs/local-data-provider.md)。
//
// 把原先糅在 host.tsx 里的「new McpServer + 注册授权 tool/resource」抽成据 Grant 起 server 的工厂。
// host.tsx 由此退化为「iframe transport 绑定」之一: 它构造 Grant + 调本工厂拿 server + 接 MessagePortTransport。
// 未来 NativeMessagingTransport / LoopbackTransport 复用同一工厂, 只换 transport 与 Grant 来源。
//
// 安全不变量 (设计 §1) 不因抽取而变: token 永不出宿主 (发布类工具在 handler 内取 token 调 ServerPort);
// 越权 = 工具不存在 (只注册 grant.permissions); 写边界校验 (safeHref/z.enum) 在 tools.ts 内, 与 transport 无关。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { isGrantActive, effectivePermissions, type Grant } from "./grant"
import { registerGrantedResources, registerGrantedTools, type HostToolsCtx } from "./tools"
import { makeScopedHost } from "./scoped-host"

/**
 * 据 Grant 起一个只挂授权能力的 McpServer (尚未接 transport)。
 * 失效 (过期/吊销) Grant → 零工具: 连容器默认的 host.toast 也不挂 (tools/list 空), 失效消费方无任何能力;
 * 不抛错, 由会话/transport 层决定是否断开。有效 Grant → 注册其授权位 (含容器默认工具)。
 * @param now 注入便于测试 (默认取系统时钟)。
 */
export function createLocalMcpServer(
  grant: Grant,
  ctx: HostToolsCtx,
  now: number = Date.now(),
): McpServer {
  const server = new McpServer({ name: "ideall-host", version: "1.0.0" })
  if (!isGrantActive(grant, now)) return server // 失效 → 空能力面 (含 host.toast 在内, tools/list 空)
  // 信任档门 (§2.1): 滤掉信任档不达标的敏感位 —— 低档消费方携敏感位也不挂对应能力。
  const perms = effectivePermissions(grant)
  // 收窄宿主句柄 (scoped-host): note/thread 正文须 perms 含 fs.notes:read 才可达, 私密读闸下沉至此。
  const host = makeScopedHost(perms)
  registerGrantedResources(server, perms, host)
  registerGrantedTools(server, perms, ctx, host)
  return server
}
