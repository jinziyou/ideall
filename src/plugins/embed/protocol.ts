// ideall 嵌入桥协议常量与类型 (宿主壳一侧)。
// 与被嵌入页 (wonita/portal `src/embed/protocol.ts`) 必须保持一致 (两个独立仓库, 各持一份)。
// 设计见 docs/ideall-embed-bridge.md。

/** 交接通信端口的握手消息 type (宿主 → iframe, 随附两个 MessagePort)。 */
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
  // fs.* 统一 Node 文件面 (§6.1, 净新建): 一切皆文件 —— 跨 kind 寻址读写统一 Node 库。
  fsList: "fs.list",
  fsRead: "fs.read",
  fsReadBlob: "fs.readBlob",
  fsCreate: "fs.create",
  fsWrite: "fs.write",
  fsMove: "fs.move",
  fsDelete: "fs.delete",
  // ui.* 标签面 (§6.1): 让消费方把节点打开为标签页。
  uiOpenTab: "ui.openTab",
  uiCloseTab: "ui.closeTab",
  hostNavigate: "host.navigate",
  hostOpenExternal: "host.openExternal",
  hostToast: "host.toast",
  // web.* agent 联网面 (出站): 把 `/tool` 搜索升级为真·抓取并返回数据。egress 守卫在 @/lib/web-search。
  webSearch: "web.search",
  webFetch: "web.fetch",
  // browser.* 内嵌浏览器面 (agent): 读当前页 / 导航 (含登录态, 非 web.fetch 重抓)。
  browserGetContent: "browser.getContent",
  browserNavigate: "browser.navigate",
  browserClick: "browser.click",
  browserFill: "browser.fill",
  browserPress: "browser.press",
} as const

export const RESOURCE = {
  identityMe: "identity://me",
  hubSubscriptions: "hub://subscriptions",
  hubBookmarks: "hub://bookmarks",
  /** 统一 Node 库快照 (note 节点剥正文, 与 fs.list 同点净化防漂移)。 */
  fsNodes: "fs://nodes",
} as const

// ── 授权位 (§6.1) ────────────────────────────────────────────────────────────────
// 单一事实源: manifest.permissions / Grant.permissions / tools.ts 的 has() 共用此联合。
// 三处 (声明授权 / 持有授权 / 注册能力) 同源, 拼错或新增能力时漏对齐即编译失败, 杜绝静默漂移
// (历史上曾出现注册了 has("hub.bookmarks:read") 的资源却无 manifest 授予该位 → 永不可达的孤立能力)。
export const PERMISSIONS = [
  "identity:read",
  "identity.publish",
  "hub.subscriptions:read",
  "hub.subscriptions:write",
  "hub.bookmarks:read",
  "hub.bookmarks:write",
  "host.external",
  "host.nav",
  // fs.* 统一 Node 文件面 (§6.2)。note 的读写在共用 handler 内二次 gate 到 fs.notes:*,
  // 防 fs:write 绕过 notes 专属位; fs:read 列 note 只回标题元数据 (正文须 fs.notes:read + 单条 consent)。
  "fs:read",
  "fs:write",
  "fs.notes:read",
  "fs.notes:write",
  // 文件二进制读: 与 note 正文同级私密闸。fs:read 只列文件元数据 (id/name/size); 取二进制 (fs.readBlob)
  // 须二次持 fs.blobs:read, 否则 consent-required。agentGrant 不含此位 —— agent 默认不能无授权把上传文件
  // (PDF/图片等) 读出外发模型端点。
  "fs.blobs:read",
  "ui.tabs",
  // web.* 出站联网 (§egress): 经守卫 (https-only + 私网/元数据 IP 拦截 + 重定向复检 + 体积/超时上限) 取数。
  // 钉死 first-party (见 grant.ts PERMISSION_MIN_TIER): 仅本应用 agent 持有, 不下放给 verified/any-origin 嵌入页。
  "web:search",
  "web:fetch",
  // browser.* 内嵌浏览器: 读当前子 webview 页 / 导航 (钉死 first-party, 仅 agent)。
  "browser:read",
  "browser:control",
] as const

/** 嵌入桥授权位 —— 宿主据此注册 tool/resource (越权 = 工具不存在)。 */
export type Permission = (typeof PERMISSIONS)[number]

export type ThemeMode = "dark" | "light"
export interface ThemeTokens {
  mode: ThemeMode
  tokens?: Record<string, string>
}

// 主题 token 白名单 (§8): 宿主把这些 CSS 自定义属性的**已解析值**随 theme 事件下发, 嵌入页写到
// :root 内联样式, 从而套宿主真实色板 (而非仅镜像 globals.css, 防两仓色板漂移)。
// 两仓 (宿主 / 被嵌入页) 须一致; 仅列两侧 D 皮肤共有的语义 token (portal 私有的 spoke-guest /
// border-strong / panel-muted / elev-* 不在此列, 由 portal 自身 globals.css 按 .dark 类推导)。
export const THEME_TOKEN_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  "--pop",
  "--pop-foreground",
  "--flowback",
  "--spoke-info",
  "--spoke-community",
  "--spoke-tool",
] as const

/** `ideall:init` 消息体 (宿主 → iframe)。 */
export interface IdeallInitMessage {
  type: typeof INIT_MESSAGE_TYPE
  protocol: string
  appId: string
  permissions: string[]
  theme: ThemeTokens
}
