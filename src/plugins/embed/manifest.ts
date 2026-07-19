// 嵌入应用 manifest —— 宿主据此校验 iframe 源 + 起对应授权集的 MCP server (§6.1)。
// info / community 是头两个一方 (first-party) 嵌入插件: wonita/portal 的单页应用 (Next.js SPA),
// 经 iframe 挂载; 插件内 /info/*、/community/* 等路由由客户端 router 切换, 不整页刷新、不经 host.navigate。
// 仅绝对外链 (https://…) 经 host.openExternal 交给宿主「浏览器」模块; host.navigate 只用于跳出到宿主壳 (如 /auth)。
import type { Permission } from "./protocol"

export interface Manifest {
  id: string
  name: string
  version: string
  /** 嵌入入口 URL。 */
  entry: string
  /** 允许的 iframe 源 (校验 + CSP frame-src 同步)。 */
  origins: string[]
  /** 要求的最低宿主协议。 */
  minHostProtocol: string
  /** 授权位 (宿主只注册这些 tool/resource); 联合类型杜绝拼错与 has() 漂移。 */
  permissions: Permission[]
}

/** 被嵌入应用 (wonita/portal) 基址 —— 默认官方 portal; 本地联调经 NEXT_PUBLIC_EMBED_BASE 覆盖。 */
const EMBED_BASE = (process.env.NEXT_PUBLIC_EMBED_BASE ?? "https://www.wonita.link").replace(
  /\/$/,
  "",
)

const EMBED_ORIGIN = (() => {
  try {
    return new URL(EMBED_BASE).origin
  } catch {
    return "https://www.wonita.link"
  }
})()

/** 资讯嵌入插件: 语料页面直连; host.external → 宿主「浏览器」模块 (外部资源, 非 iframe 内跳转)。 */
export const infoEmbedManifest: Manifest = {
  id: "info",
  name: "Wonita 资讯",
  version: "1.0.0",
  entry: `${EMBED_BASE}/info`,
  origins: [EMBED_ORIGIN],
  minHostProtocol: "1.0",
  permissions: [
    "hub.subscriptions:read",
    "hub.subscriptions:write",
    "hub.bookmarks:write",
    "host.external",
    "host.nav",
  ],
}

/** 社区嵌入应用: 含完整发布流程 → 需 identity:read + identity.publish (token 由宿主持有)。 */
export const communityEmbedManifest: Manifest = {
  id: "community",
  name: "Wonita 社区",
  version: "1.0.0",
  entry: `${EMBED_BASE}/community`,
  origins: [EMBED_ORIGIN],
  minHostProtocol: "1.1",
  permissions: [
    "identity:read",
    "identity.publish",
    "hub.subscriptions:read",
    "hub.subscriptions:write",
    "hub.bookmarks:write",
    "host.external",
    "host.nav",
  ],
}
