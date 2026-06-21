// ideall 嵌入桥协议常量与类型 (宿主壳一侧)。
// 与被嵌入页 (wonita/portal `src/embed/protocol.ts`) 必须保持一致 (两个独立仓库, 各持一份)。
// 设计见 jinziyou docs/ideall-embed-bridge.md。

/** 端口移交握手消息 type (宿主 → iframe, 随附两个 MessagePort)。 */
export const INIT_MESSAGE_TYPE = "ideall:init"

/** 被嵌入页就绪握手 (iframe → 宿主, 主动索取 init, 消除 'load' 时序竞争)。 */
export const HELLO_MESSAGE_TYPE = "ideall:embed-hello"

/** 传输/握手协议版本。 */
export const PROTOCOL_VERSION = "1.0"

// ── MCP 工具名 / 资源 URI (§5) ───────────────────────────────────────────────────
export const TOOL = {
  identityMe: "identity.me",
  communityPublish: "community.publish",
  communityDeletePublication: "community.deletePublication",
  meUpdateProfile: "me.updateProfile",
  hubListSubscriptions: "hub.listSubscriptions",
  hubAddSubscription: "hub.addSubscription",
  hubRemoveSubscription: "hub.removeSubscription",
  hubIsSubscribed: "hub.isSubscribed",
  hubAddBookmark: "hub.addBookmark",
  hostNavigate: "host.navigate",
  hostOpenExternal: "host.openExternal",
  hostToast: "host.toast",
} as const

export const RESOURCE = {
  identityMe: "identity://me",
  hubSubscriptions: "hub://subscriptions",
  hubBookmarks: "hub://bookmarks",
} as const

export type ThemeMode = "dark" | "light"
export interface ThemeTokens {
  mode: ThemeMode
  tokens?: Record<string, string>
}

/** `ideall:init` 消息体 (宿主 → iframe)。 */
export interface IdeallInitMessage {
  type: typeof INIT_MESSAGE_TYPE
  protocol: string
  appId: string
  permissions: string[]
  theme: ThemeTokens
}
