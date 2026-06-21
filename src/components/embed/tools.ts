// 把授权位映射到宿主能力 (getServerPort / getHubData / auth-store) 并注册到 MCP server。
// 只注册 manifest 授予的 tool/resource → tools/list 天然只暴露可用项 (越权调用 = 工具不存在)。
// **token 永不返回给页面**: 发布类工具在 handler 内从 auth-store 取 token 调 ServerPort。
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getServerPort } from "@protocol/server-port"
import { getHubData } from "@protocol/hub-data"
import type { NewSubscription, SubscriptionType } from "@protocol/subscription"
import type { NewBookmark } from "@protocol/hub-data"
import { getSession } from "@/components/lib/auth/auth-store"
import { openExternalUrl } from "@/components/lib/tauri"
import { toast } from "sonner"
import { TOOL, RESOURCE } from "./protocol"

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean }

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data ?? null) }] }
}
function fail(code: number, message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ code, message }) }] }
}

export interface HostToolsCtx {
  /** ideall 内部路由跳转 (host.navigate)。 */
  navigate: (route: string) => void
}

/** host.navigate 允许的内部路由前缀 (白名单, §5.2)。 */
const NAV_ALLOW = ["/home", "/auth", "/info", "/community", "/tool"]

export function registerGrantedTools(server: McpServer, perms: string[], ctx: HostToolsCtx): void {
  const has = (p: string) => perms.includes(p)

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
        const r = await getServerPort().publish(s.token, { title: a.title, url: a.url, body: a.body })
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
    server.tool(TOOL.hubIsSubscribed, { type: z.string(), key: z.string() }, async (a) =>
      ok(await getHubData().isSubscribed(a.type as SubscriptionType, a.key)),
    )
    server.tool(TOOL.hubListSubscriptions, {}, async () => ok(await getHubData().listSubscriptions()))
  }

  if (has("hub.subscriptions:write")) {
    server.tool(
      TOOL.hubAddSubscription,
      {
        type: z.string(),
        key: z.string(),
        title: z.string(),
        favicon: z.string().optional(),
        entityLabel: z.string().optional(),
        entityName: z.string().optional(),
        searchKeyword: z.string().optional(),
        searchDomain: z.string().optional(),
      },
      async (a) => ok(await getHubData().addSubscription(a as NewSubscription)),
    )
    server.tool(TOOL.hubRemoveSubscription, { type: z.string(), key: z.string() }, async (a) => {
      await getHubData().removeSubscription(a.type as SubscriptionType, a.key)
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
        const hub = getHubData()
        // 去重: addBookmark 非幂等; 同 url 重复点会产生重复书签 (与 ideall SaveToHub 一致)。
        const existing = await hub.listBookmarks()
        const dup = existing.find((b) => b.url === a.url)
        if (dup) return ok(dup)
        return ok(await hub.addBookmark(a as NewBookmark))
      },
    )
  }

  // ── host / 外壳能力 ─────────────────────────────────────────────────────────
  if (has("host.external")) {
    server.tool(TOOL.hostOpenExternal, { url: z.string() }, async (a) => {
      try {
        const u = new URL(a.url)
        if (u.protocol !== "http:" && u.protocol !== "https:") return fail(-32602, "blocked-protocol")
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
export function registerGrantedResources(server: McpServer, perms: string[]): void {
  const has = (p: string) => perms.includes(p)
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
}
