// 外部 MCP server 的 OAuth (授权码 + PKCE + 动态注册 + 刷新) —— 手动粘贴授权码模式。
// 用 SDK 的 auth() 驱动: 打开系统浏览器授权页, 用户把回调 URL/code 粘回换 token; 跨 web/桌面、不依赖 Rust 回调。
// token / client / verifier 仅存本机 localStorage (per server id)。连接时把本 provider 传给 transport (authProvider),
// SDK 自动带 Bearer 并在过期时刷新。
//
// redirect_uri 用 native loopback 占位: 授权后浏览器跳到它 (无监听 → 连接失败页, 但地址栏含 ?code=&state=),
// 用户复制整条回调 URL 粘回即可。多数授权服务器接受 127.0.0.1 回环 (RFC 8252)。

import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import { isTauri } from "@/lib/tauri"

const REDIRECT_URI = "http://127.0.0.1:7843/callback"

const CLIENT_METADATA: OAuthClientMetadata = {
  client_name: "ideall",
  redirect_uris: [REDIRECT_URI],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none", // public client + PKCE
}

interface OAuthState {
  clientInfo?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  codeVerifier?: string
  state?: string
  /** 上次发起授权打开的 URL (供 UI 在弹窗被拦时显示可点链接)。 */
  lastAuthUrl?: string
}

const keyOf = (serverId: string) => `ideall:agent:oauth:${serverId}`

function load(serverId: string): OAuthState {
  if (typeof localStorage === "undefined") return {}
  try {
    const raw = localStorage.getItem(keyOf(serverId))
    return raw ? (JSON.parse(raw) as OAuthState) : {}
  } catch {
    return {}
  }
}

function write(serverId: string, s: OAuthState): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(keyOf(serverId), JSON.stringify(s))
  } catch {
    /* 隐私模式 / 配额满 → 放弃持久化 */
  }
}

function patch(serverId: string, p: Partial<OAuthState>): void {
  write(serverId, { ...load(serverId), ...p })
}

async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener")
      await openUrl(url)
      return
    } catch {
      /* 退化到 window.open */
    }
  }
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer")
}

function randomState(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
  } catch {
    /* 落到下面 */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 一个 MCP server 的 OAuth provider (无内存态; 全部读写 localStorage, 故可每次 new 且跨实例共享)。 */
class McpOAuthProvider implements OAuthClientProvider {
  constructor(private readonly serverId: string) {}

  get redirectUrl(): string {
    return REDIRECT_URI
  }
  get clientMetadata(): OAuthClientMetadata {
    return CLIENT_METADATA
  }
  state(): string {
    const s = randomState()
    patch(this.serverId, { state: s })
    return s
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    return load(this.serverId).clientInfo
  }
  saveClientInformation(info: OAuthClientInformationMixed): void {
    patch(this.serverId, { clientInfo: info })
  }
  tokens(): OAuthTokens | undefined {
    return load(this.serverId).tokens
  }
  saveTokens(t: OAuthTokens): void {
    patch(this.serverId, { tokens: t })
  }
  saveCodeVerifier(v: string): void {
    patch(this.serverId, { codeVerifier: v })
  }
  codeVerifier(): string {
    const v = load(this.serverId).codeVerifier
    if (!v) throw new Error("缺少 code verifier，请重新发起授权")
    return v
  }
  redirectToAuthorization(url: URL): void {
    patch(this.serverId, { lastAuthUrl: url.toString() }) // 暴露给 UI 作弹窗被拦时的回退链接
    void openExternal(url.toString())
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "all") {
      clearMcpAuth(this.serverId)
      return
    }
    const s = load(this.serverId)
    if (scope === "tokens") delete s.tokens
    if (scope === "client") delete s.clientInfo
    if (scope === "verifier") delete s.codeVerifier
    write(this.serverId, s)
  }
}

export function mcpOAuthProvider(serverId: string): OAuthClientProvider {
  return new McpOAuthProvider(serverId)
}

/** 回调 URL 或裸 code → {code, state}。 */
export function parseAuthCallback(input: string): { code?: string; state?: string } {
  const s = input.trim()
  try {
    const u = new URL(s)
    return {
      code: u.searchParams.get("code") ?? undefined,
      state: u.searchParams.get("state") ?? undefined,
    }
  } catch {
    return { code: s || undefined } // 不是 URL → 当裸 code
  }
}

/** 发起授权: discover + (动态注册) + PKCE + 打开授权页。'AUTHORIZED'=已有有效 token; 'REDIRECT'=待粘回调。 */
export function startMcpAuth(
  serverId: string,
  serverUrl: string,
): Promise<"AUTHORIZED" | "REDIRECT"> {
  return auth(mcpOAuthProvider(serverId), { serverUrl })
}

/** 用回调 URL/code 完成授权: 校验 state, 交换 token。 */
export async function finishMcpAuth(
  serverId: string,
  callback: string,
  serverUrl: string,
): Promise<void> {
  const { code, state } = parseAuthCallback(callback)
  if (!code) throw new Error("回调里没有 code")
  const saved = load(serverId).state
  // 有 saved state 就必须严格匹配 (回调缺 state 也算不匹配, 不让其绕过校验)。
  if (saved && state !== saved) {
    throw new Error("state 不匹配（可能过期或 CSRF），请重新发起授权")
  }
  const r = await auth(mcpOAuthProvider(serverId), { serverUrl, authorizationCode: code })
  if (r !== "AUTHORIZED") throw new Error("授权未完成")
  patch(serverId, { state: undefined }) // state 单次用, 用后清
}

/** 是否已授权 (有 access token)。 */
export function isMcpAuthorized(serverId: string): boolean {
  return Boolean(load(serverId).tokens?.access_token)
}

/** 上次发起授权打开的 URL (弹窗被拦时 UI 显示可点链接作回退)。 */
export function lastAuthUrl(serverId: string): string | undefined {
  return load(serverId).lastAuthUrl
}

/** 撤销本地保存的授权 (token/client/verifier)。 */
export function clearMcpAuth(serverId: string): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(keyOf(serverId))
}
