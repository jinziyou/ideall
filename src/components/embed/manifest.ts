// 嵌入应用 manifest —— 宿主据此校验 iframe 源 + 起对应授权集的 MCP server (§6.1)。
// info / community 是头两个一方 (first-party) 嵌入应用, 由 wonita/portal 实现。

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
  /** 授权位 (宿主只注册这些 tool/resource)。 */
  permissions: string[]
}

/** 被嵌入应用 (wonita/portal) 基址 —— 开发默认 localhost:5024, 生产 web.wonita.link。 */
const EMBED_BASE = (process.env.NEXT_PUBLIC_EMBED_BASE ?? "http://localhost:5024").replace(/\/$/, "")

const EMBED_ORIGIN = (() => {
  try {
    return new URL(EMBED_BASE).origin
  } catch {
    return "http://localhost:5024"
  }
})()

/** 资讯嵌入应用: 公共语料页面直连, 故不需 data.info:read; 仅需订阅/收藏回写 + 外链/导航。 */
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

/** 社区嵌入应用: 含发布闭环 → 需 identity:read + identity.publish (token 由宿主持有)。 */
export const communityEmbedManifest: Manifest = {
  id: "community",
  name: "Wonita 社区",
  version: "1.0.0",
  entry: `${EMBED_BASE}/community`,
  origins: [EMBED_ORIGIN],
  minHostProtocol: "1.0",
  permissions: [
    "identity:read",
    "identity.publish",
    "hub.subscriptions:read",
    "hub.subscriptions:write",
    "host.external",
    "host.nav",
  ],
}
