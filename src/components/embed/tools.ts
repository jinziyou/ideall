// 把授权位映射到宿主能力 (getServerPort / getHubData / auth-store) 并注册到 MCP server。
// 只注册 manifest 授予的 tool/resource → tools/list 天然只暴露可用项 (越权调用 = 工具不存在)。
// **token 永不返回给页面**: 发布类工具在 handler 内从 auth-store 取 token 调 ServerPort。
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getServerPort } from "@protocol/server-port"
import { getHubData } from "@protocol/hub-data"
import type { NewBookmark } from "@protocol/hub-data"
import { stripNode, type NodeKind } from "@protocol/node"
import { getSession } from "@/components/lib/auth/auth-store"
import { openExternalUrl } from "@/components/lib/tauri"
import { safeHref } from "@/components/lib/safe-url"
import { toast } from "sonner"
import { TOOL, RESOURCE, type Permission } from "./protocol"

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean }

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data ?? null) }] }
}
function fail(code: number, message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ code, message }) }] }
}

// 订阅类型白名单: 用 zod enum 让 handler 直接拿到领域联合 (SubscriptionType), 杜绝任意字符串写入脏订阅。
const subType = z.enum(["publisher", "entity", "tool", "search", "peer"])

// 节点 kind 白名单 (fs.* 文件面)。缺省 kind = 列全部命名空间。
const nodeKind = z.enum(["folder", "note", "bookmark", "file", "feed", "thread"])
const ALL_NODE_KINDS: NodeKind[] = [...nodeKind.options]

export interface HostToolsCtx {
  /** ideall 内部路由跳转 (host.navigate)。 */
  navigate: (route: string) => void
  /** 打开节点标签 (ui.openTab); 不支持标签的宿主不提供 → ui 工具不注册。 */
  openTab?: (kind: NodeKind, id: string, title: string) => void
  /** 关闭节点标签 (ui.closeTab)。 */
  closeTab?: (kind: NodeKind, id: string) => void
}

/** host.navigate 允许的内部路由前缀 (白名单, §5.2)。 */
const NAV_ALLOW = ["/home", "/auth", "/info", "/community", "/tool"]

export function registerGrantedTools(
  server: McpServer,
  perms: Permission[],
  ctx: HostToolsCtx,
): void {
  const has = (p: Permission) => perms.includes(p)

  // ── identity / 发布 ─────────────────────────────────────────────────────────
  if (has("identity:read")) {
    server.tool(TOOL.identityMe, {}, async () => {
      const s = getSession()
      return ok(s?.user ?? null)
    })
  }

  if (has("identity.publish")) {
    server.tool(
      TOOL.communityPublish,
      { title: z.string(), url: z.string().optional(), body: z.string().optional() },
      async (a) => {
        const s = getSession()
        if (!s) return fail(-32002, "not-authenticated")
        const r = await getServerPort().publish(s.token, {
          title: a.title,
          url: a.url,
          body: a.body,
        })
        return r.ok ? ok(r.data) : fail(-32000, r.message)
      },
    )

    server.tool(TOOL.communityDeletePublication, { id: z.number() }, async (a) => {
      const s = getSession()
      if (!s) return fail(-32002, "not-authenticated")
      const r = await getServerPort().deletePublication(s.token, a.id)
      return r.ok ? ok({ ok: true }) : fail(-32000, r.message)
    })

    server.tool(
      TOOL.meUpdateProfile,
      { name: z.string().optional(), avatar: z.string().optional() },
      async (a) => {
        const s = getSession()
        if (!s) return fail(-32002, "not-authenticated")
        const r = await getServerPort().updateProfile(s.token, { name: a.name, avatar: a.avatar })
        return r.ok ? ok({ ok: true }) : fail(-32000, r.message)
      },
    )
  }

  // ── hub / 本地主权数据 ──────────────────────────────────────────────────────
  if (has("hub.subscriptions:read")) {
    server.tool(TOOL.hubIsSubscribed, { type: subType, key: z.string() }, async (a) =>
      ok(await getHubData().isSubscribed(a.type, a.key)),
    )
    server.tool(TOOL.hubListSubscriptions, {}, async () =>
      ok(await getHubData().listSubscriptions()),
    )
  }

  if (has("hub.subscriptions:write")) {
    server.tool(
      TOOL.hubAddSubscription,
      {
        type: subType,
        key: z.string(),
        title: z.string(),
        favicon: z.string().optional(),
        entityLabel: z.string().optional(),
        entityName: z.string().optional(),
        searchKeyword: z.string().optional(),
        searchDomain: z.string().optional(),
      },
      async (a) => {
        // tool 订阅的 key 即启动 URL, 会渲染成 <a href>; 过协议白名单拦伪协议 (与 hubAddBookmark 一致),
        // 防持权 iframe 经 MCP 注入 javascript: 工具订阅 → 用户点击触发存储型 XSS。
        if (a.type === "tool" && !safeHref(a.key)) return fail(-32602, "blocked-protocol")
        return ok(await getHubData().addSubscription(a))
      },
    )
    server.tool(TOOL.hubRemoveSubscription, { type: subType, key: z.string() }, async (a) => {
      await getHubData().removeSubscription(a.type, a.key)
      return ok({ ok: true })
    })
  }

  if (has("hub.bookmarks:write")) {
    server.tool(
      TOOL.hubAddBookmark,
      {
        title: z.string(),
        url: z.string(),
        description: z.string().optional(),
        favicon: z.string().optional(),
        folderId: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
      },
      async (a) => {
        // 第三方嵌入页经 MCP 传入 url: 过协议白名单 (与 agent-tools 写入边界一致), 拦 javascript:/data: 伪协议入库。
        if (!safeHref(a.url)) return fail(-32602, "blocked-protocol")
        const hub = getHubData()
        // 去重: addBookmark 非幂等; 同 url 重复点会产生重复书签 (与 ideall SaveToHub 一致)。
        const existing = await hub.listBookmarks()
        const dup = existing.find((b) => b.url === a.url)
        if (dup) return ok(dup)
        return ok(await hub.addBookmark(a as NewBookmark))
      },
    )
  }

  // ── fs.* 统一 Node 文件面 (§6, 净新建) ──────────────────────────────────────
  if (has("fs:read")) {
    // fs.list: 列节点元数据。note/thread 一律经 stripNode 剥正文/消息 —— 批量永不回私密内容
    // (即便持 fs.notes:read; 正文须 fs.read 单条 + consent)。可选 parentId 过滤同级。
    server.tool(
      TOOL.fsList,
      { kind: nodeKind.optional(), parentId: z.string().nullable().optional() },
      async (a) => {
        const kinds = a.kind ? [a.kind] : ALL_NODE_KINDS
        let nodes = await getHubData().fsListNodes(kinds)
        if (a.parentId !== undefined) nodes = nodes.filter((n) => n.parentId === a.parentId)
        return ok(nodes.map(stripNode))
      },
    )
    // fs.read: 读单个节点完整内容。私密内容 (note 正文 / thread 会话, 与 stripNode 同口径) 二次 gate
    // 到 fs.notes:read (= 私密读 consent 位); 无则 consent-required (@ 引用单条单次临时注入)。余 fs:read 即可。
    // 防 fs.read(thread) 在仅持 fs:read 时绕过 (批量已剥 messages, 单读须同等 gate, 否则会话泄漏)。
    server.tool(TOOL.fsRead, { kind: nodeKind, id: z.string() }, async (a) => {
      const n = await getHubData().fsGetNode(a.id)
      if (!n || n.kind !== a.kind) return fail(-32004, "not-found")
      if ((n.kind === "note" || n.kind === "thread") && !has("fs.notes:read"))
        return fail(-32003, "consent-required")
      return ok(n)
    })
    // fs.readBlob: 文件二进制 base64 (大文件不内联)。
    server.tool(TOOL.fsReadBlob, { id: z.string() }, async (a) => {
      const r = await getHubData().fsReadBlob(a.id)
      return r ? ok(r) : fail(-32004, "not-found")
    })
  }

  // fs.* 写: note 二次 gate 到 fs.notes:write (防 fs:write 绕过 notes 专属位 §6.2); 余 fs:write。
  // 工具在持任一写位时注册, handler 内按 kind 二次校验 (notes-only 消费方只能写 note)。
  if (has("fs:write") || has("fs.notes:write")) {
    const canWrite = (k: NodeKind) => (k === "note" ? has("fs.notes:write") : has("fs:write"))
    const fsWriteErr = (e: unknown) =>
      fail(-32000, e instanceof Error ? e.message : "fs-write-failed")

    server.tool(
      TOOL.fsCreate,
      {
        kind: nodeKind,
        parentId: z.string().nullable().optional(),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        content: z.unknown().optional(),
      },
      async (a) => {
        if (!canWrite(a.kind)) return fail(-32003, "consent-required")
        try {
          return ok(await getHubData().fsCreateNode(a))
        } catch (e) {
          return fsWriteErr(e)
        }
      },
    )

    server.tool(
      TOOL.fsWrite,
      {
        kind: nodeKind,
        id: z.string(),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        content: z.unknown().optional(),
        parentId: z.string().nullable().optional(),
      },
      async (a) => {
        if (!canWrite(a.kind)) return fail(-32003, "consent-required")
        try {
          const n = await getHubData().fsUpdateNode(a.kind, a.id, {
            title: a.title,
            tags: a.tags,
            content: a.content,
            parentId: a.parentId,
          })
          return n ? ok(n) : fail(-32004, "not-found")
        } catch (e) {
          return fsWriteErr(e)
        }
      },
    )

    server.tool(
      TOOL.fsMove,
      {
        kind: nodeKind,
        id: z.string(),
        parentId: z.string().nullable(),
        afterSortKey: z.string().nullable().optional(),
      },
      async (a) => {
        if (!canWrite(a.kind)) return fail(-32003, "consent-required")
        try {
          const n = await getHubData().fsMoveNode(a.kind, a.id, a.parentId, a.afterSortKey)
          return n ? ok(n) : fail(-32004, "not-found")
        } catch (e) {
          return fsWriteErr(e)
        }
      },
    )

    server.tool(TOOL.fsDelete, { kind: nodeKind, id: z.string() }, async (a) => {
      if (!canWrite(a.kind)) return fail(-32003, "consent-required")
      try {
        await getHubData().fsDeleteNode(a.kind, a.id)
        return ok({ ok: true })
      } catch (e) {
        return fsWriteErr(e)
      }
    })
  }

  // ── ui.* 标签面 (§6.1): 把节点物化为标签 ─────────────────────────────────────
  if (has("ui.tabs") && ctx.openTab) {
    server.tool(
      TOOL.uiOpenTab,
      { kind: nodeKind, id: z.string(), title: z.string().optional() },
      async (a) => {
        ctx.openTab!(a.kind, a.id, a.title || a.id)
        return ok({ ok: true })
      },
    )
    if (ctx.closeTab) {
      server.tool(TOOL.uiCloseTab, { kind: nodeKind, id: z.string() }, async (a) => {
        ctx.closeTab!(a.kind, a.id)
        return ok({ ok: true })
      })
    }
  }

  // ── host / 外壳能力 ─────────────────────────────────────────────────────────
  if (has("host.external")) {
    server.tool(TOOL.hostOpenExternal, { url: z.string() }, async (a) => {
      try {
        const u = new URL(a.url)
        if (u.protocol !== "http:" && u.protocol !== "https:")
          return fail(-32602, "blocked-protocol")
      } catch {
        return fail(-32602, "invalid-url")
      }
      await openExternalUrl(a.url)
      return ok({ ok: true })
    })
  }

  if (has("host.nav")) {
    server.tool(TOOL.hostNavigate, { route: z.string() }, async (a) => {
      const allowed = NAV_ALLOW.some(
        (p) => a.route === p || a.route.startsWith(`${p}/`) || a.route.startsWith(`${p}?`),
      )
      if (!allowed) return fail(-32602, "route-not-allowed")
      ctx.navigate(a.route)
      return ok({ ok: true })
    })
  }

  // host.toast: 随容器默认 (无需专门授权位)。
  server.tool(
    TOOL.hostToast,
    { message: z.string(), kind: z.enum(["info", "error"]).optional() },
    async (a) => {
      if (a.kind === "error") toast.error(a.message)
      else toast(a.message)
      return ok({ ok: true })
    },
  )
}

/** 注册授权范围内的只读资源 (resources/read)。 */
export function registerGrantedResources(server: McpServer, perms: Permission[]): void {
  const has = (p: Permission) => perms.includes(p)
  const json = (uri: string, data: unknown) => ({
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data ?? null) }],
  })

  if (has("identity:read")) {
    server.resource("identity-me", RESOURCE.identityMe, async (uri) =>
      json(uri.href, getSession()?.user ?? null),
    )
  }
  if (has("hub.subscriptions:read")) {
    server.resource("hub-subscriptions", RESOURCE.hubSubscriptions, async (uri) =>
      json(uri.href, await getHubData().listSubscriptions()),
    )
  }
  if (has("hub.bookmarks:read")) {
    server.resource("hub-bookmarks", RESOURCE.hubBookmarks, async (uri) =>
      json(uri.href, await getHubData().listBookmarks()),
    )
  }
  if (has("fs:read")) {
    // fs://nodes 全库快照: 与 fs.list 同点经 stripNode 净化 (note/thread 剥私密内容), 防净化漂移。
    server.resource("fs-nodes", RESOURCE.fsNodes, async (uri) =>
      json(uri.href, (await getHubData().fsListNodes(ALL_NODE_KINDS)).map(stripNode)),
    )
  }
}
