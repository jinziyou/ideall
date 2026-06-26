// agent 联网能力 (web.search / web.fetch) 的纯逻辑实现 —— lib 叶子。
//
// 经 MCP 统一能力层 (src/plugins/embed/tools.ts) 注册供 agent (loopback) 调用; 是 `/tool` 模块「返回数据」化的核心:
// 把原先只 link-out 的搜索升级为真·抓取并把结果回喂模型。放在 lib 是因为 (a) plugins 与 modules 都可无边界依赖,
// (b) 它的依赖 (@/lib/tauri 的 isTauri/agentGuardedFetch、@/lib/safe-url 的 safeHref) 本就在 lib, (c) 纯逻辑无 React/DOM,
// 可在 webview 与 `node --test` 同构运行 (故 HTML 解析用 regex 而非 DOMParser —— node 测试环境无 DOM)。
//
// ── 安全姿态 (egress 守卫, 见 .github/SECURITY.md) ────────────────────────────────────────────────
// agent 的网络出站 = 真实攻击面: SSRF (环回/内网/云元数据)、经构造 URL 把本机元数据外泄、抓取的 HTML 回灌进
// 模型循环造成间接提示注入。所有出站经单一收口 guardedFetch + transportFetch 强制, 分两层:
//   ① JS 层 (两态通用, assertEgressAllowed): 仅 https (连明文 http 都拒)、拒带 userinfo、端口仅 443; 解析 IP 字面量拦
//      环回/私网/link-local(含 169.254.169.254 元数据)/ULA/CGNAT/广播 (IPv6 按字节解, 含 ::ffff: 映射); 名字面拦
//      localhost/.local/.internal; 重定向 manual 逐跳重跑同一策略 (≤3 跳); web.fetch 回喂前抽正文截断, 调用方标注「数据非指令」。
//   ② Rust 层 (App 形态, agent_guarded_fetch 命令): 解析主机→校验**所有**解析 IP→resolve_to_addrs **钉连**到已校验 IP,
//      关闭 JS 拦不住的「公网域名 A 记录指向私网」名解析 SSRF 与 DNS-rebind/TOCTOU (校验与连接同源, reqwest 不二次解析);
//      Rust 侧同样做体积/超时/解压计数上限、仅 GET、不带凭证。
// 残余: 纯浏览器/dev 态 (非 App) 无 Rust 命令, 退回标准 fetch 受 CORS 限制 (仅 CORS-* 源可用) 且名解析 SSRF 不闭合 ——
// 但 agent 仅以 App 形态分发, 此态仅本地开发用; 文档记录之。
import { isTauri, agentGuardedFetch } from "@/lib/tauri"
import { safeHref } from "@/lib/safe-url"

/** 出站/解析失败的领域错误; tools.ts handler 捕获后映射为 MCP fail(code, reason)。 */
export class WebError extends Error {
  constructor(
    public reason: string,
    public code: number = -32000,
  ) {
    super(reason)
    this.name = "WebError"
  }
}

const FETCH_TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2MB
const MAX_REDIRECTS = 3
const DEFAULT_FETCH_CHARS = 8_000
const MAX_FETCH_CHARS = 20_000
const DEFAULT_SEARCH_LIMIT = 5
const MAX_SEARCH_LIMIT = 10
const TITLE_CAP = 200
const SNIPPET_CAP = 400

// web.fetch 回喂模型的可读内容类型白名单 (拒二进制, 防把图片/压缩包灌进上下文)。
const ALLOWED_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "application/json",
  "application/xml",
  "text/xml",
])

// 桌面 UA + 语言: App 形态经 Rust 命令可设这两个头; 浏览器态 User-Agent 是禁止头会被静默忽略 (不抛错)。
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const ACCEPT_LANG = "zh-CN,zh;q=0.9,en;q=0.8"

// ── egress 守卫 ───────────────────────────────────────────────────────────────────────────────────

/** IPv4 字面量是否落在非全局可路由段 (环回/私网/link-local/CGNAT/广播)。非法八位组也判可疑→拦。 */
function isBlockedIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const o = m.slice(1).map(Number)
  if (o.some((n) => n > 255)) return true
  const [a, b, c, d] = o
  if (a === 0) return true // 0.0.0.0/8 (含 unspecified)
  if (a === 10) return true // 10/8
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local + 云元数据 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24 (IETF 协议保留)
  if (a === 255 && b === 255 && c === 255 && d === 255) return true // 广播
  return false
}

/**
 * 把 IPv6 字面量 (已去方括号) 展开成 16 字节, 非法回 null。
 * 关键: 按**字节**判而非文本前缀 —— `new URL` 会把内嵌 IPv4 序列化成 16 进制 (`::ffff:127.0.0.1` → `::ffff:7f00:1`),
 * 文本正则匹配会漏 (红队确认的 SSRF 绕过); 字节判则与文本形态无关。同时解内嵌 IPv4 文本形与 16 进制形。
 */
function ipv6Bytes(host: string): number[] | null {
  let h = host.toLowerCase()
  // 内嵌 IPv4 (如 ::ffff:127.0.0.1) → 折成两个 16 进制段, 统一走下面的展开。
  const lastColon = h.lastIndexOf(":")
  const tail = h.slice(lastColon + 1)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) {
    const o = tail.split(".").map(Number)
    if (o.some((n) => n > 255)) return null
    const hi = ((o[0] << 8) | o[1]).toString(16)
    const lo = ((o[2] << 8) | o[3]).toString(16)
    h = h.slice(0, lastColon + 1) + hi + ":" + lo
  }
  if (h.indexOf("::") !== h.lastIndexOf("::")) return null // 多个 :: 非法
  const hasGap = h.includes("::")
  const [head, rest] = hasGap ? h.split("::") : [h, ""]
  const headParts = head ? head.split(":") : []
  const tailParts = hasGap && rest ? rest.split(":") : []
  if (!hasGap && headParts.length !== 8) return null
  const fill = 8 - headParts.length - tailParts.length
  if (fill < (hasGap ? 0 : 8)) return null
  const groups = [...headParts, ...Array(hasGap ? fill : 0).fill("0"), ...tailParts]
  if (groups.length !== 8) return null
  const bytes: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    const v = parseInt(g, 16)
    bytes.push(v >> 8, v & 255)
  }
  return bytes
}

/** IPv6 字面量 (已去方括号) 是否为 环回/未指定/link-local/ULA, 或内嵌 (mapped/compat) 回坏 IPv4。 */
function isBlockedIpv6(host: string): boolean {
  const b = ipv6Bytes(host)
  if (!b) return true // 解析不了的 IPv6 当可疑 → 拦
  if (b.every((x) => x === 0)) return true // :: 未指定
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true // ::1 环回
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true // fe80::/10 link-local
  if ((b[0] & 0xfe) === 0xfc) return true // fc00::/7 ULA
  // IPv4-mapped ::ffff:0:0/96 — 前 10 字节 0, [10]=[11]=0xff
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    return isBlockedIpv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`)
  }
  // IPv4-compatible ::a.b.c.d (已废弃但仍可解析) — 前 12 字节 0
  if (b.slice(0, 12).every((x) => x === 0)) {
    return isBlockedIpv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`)
  }
  return false
}

/** 名字面拦截 (域名解析到 IP 这步 JS 在 webview 内做不了; 仅拦已知本地/内网名)。 */
function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "")
  if (h === "localhost" || h === "ip6-localhost") return true
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true
  if (h === "metadata.google.internal") return true
  return false
}

/** 出站 URL 必过的策略闸; 通过则回规范化 URL, 否则抛 WebError(-32602)。 */
function assertEgressAllowed(rawUrl: string): URL {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    throw new WebError("invalid-url", -32602)
  }
  if (u.protocol !== "https:") throw new WebError("blocked-protocol", -32602)
  if (u.username || u.password) throw new WebError("blocked-host", -32602)
  if (u.port && u.port !== "443") throw new WebError("blocked-port", -32602)
  const host = u.hostname.replace(/^\[/, "").replace(/\]$/, "")
  if (host.includes(":")) {
    if (isBlockedIpv6(host)) throw new WebError("blocked-host", -32602)
  } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isBlockedIpv4(host)) throw new WebError("blocked-host", -32602)
  } else if (isBlockedHostname(host)) {
    throw new WebError("blocked-host", -32602)
  }
  return u
}

/** 单跳取数的规范化结果 (transport 无关; text 为已截断的正文)。 */
interface GuardedResponse {
  status: number
  ok: boolean
  finalUrl: string
  contentType: string | null
  location: string | null
  text: string
}

/**
 * 单跳取数 (transport 相关, 不跟随重定向)。
 *  - App 形态: 经 Rust `agent_guarded_fetch` 命令 —— 解析主机→校验所有 IP→钉连 (关闭 DNS-rebind/名解析 SSRF),
 *    Rust 侧已做体积/超时/解压计数上限。
 *  - 非 App (dev/test): 标准 fetch (受 webview CORS 限制, 仅 CORS-* 源可用) + JS 流式守卫 (readCappedText)。
 */
async function transportFetch(
  target: string,
  method: string,
  body: string | undefined,
  headers: Record<string, string> | undefined,
): Promise<GuardedResponse> {
  const hdrs = { "User-Agent": DESKTOP_UA, "Accept-Language": ACCEPT_LANG, ...headers }
  if (isTauri()) {
    const r = await agentGuardedFetch({
      url: target,
      method,
      body,
      headers: hdrs,
      maxBytes: MAX_BODY_BYTES,
      timeoutMs: FETCH_TIMEOUT_MS,
    })
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      finalUrl: r.finalUrl || target,
      contentType: r.contentType,
      location: r.location,
      text: r.body,
    }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(target, {
      method,
      body,
      headers: hdrs,
      redirect: "manual",
      credentials: "omit",
      signal: ctrl.signal,
    })
    // 标准 fetch 的 manual 重定向 → opaqueredirect (status 0, 读不到 Location): 无法复检 → 拒。
    if (res.type === "opaqueredirect" || res.status === 0) {
      throw new WebError("redirect-blocked", -32602)
    }
    const status = res.status
    const location = res.headers.get("location")
    const contentType = res.headers.get("content-type")
    const finalUrl = res.url || target
    if (status >= 300 && status < 400) {
      return { status, ok: false, finalUrl, contentType, location, text: "" }
    }
    return { status, ok: res.ok, finalUrl, contentType, location, text: await readCappedText(res) }
  } catch (e) {
    if (e instanceof WebError) throw e
    throw new WebError(ctrl.signal.aborted ? "timeout" : "fetch-failed", -32000)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 出站取数 + 逐跳重定向复检 (≤3)。每跳都过 JS 字面量/名字面闸 assertEgressAllowed; App 形态每跳还经 Rust
 * 重解析+钉连 —— 故「公网域名 A 记录指向私网」也在连接前被拦 (rebind 也无机会, 校验与连接同源)。
 */
async function guardedFetch(
  rawUrl: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): Promise<GuardedResponse> {
  let target = assertEgressAllowed(rawUrl).href
  let method = init?.method ?? "GET"
  let body = init?.body
  const headers = init?.headers
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await transportFetch(target, method, body, headers)
    if (r.status >= 300 && r.status < 400) {
      if (!r.location || hop === MAX_REDIRECTS) throw new WebError("too-many-redirects", -32602)
      target = assertEgressAllowed(new URL(r.location, target).href).href
      // 301/302/303 按 HTTP 语义把后续请求降级为 GET 并丢 body (不把 POST 查询体重放到重定向目标)。
      if (r.status === 301 || r.status === 302 || r.status === 303) {
        method = "GET"
        body = undefined
      }
      continue
    }
    return r
  }
  throw new WebError("too-many-redirects", -32602)
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let len = 0
  for (const c of chunks) len += c.byteLength
  const out = new Uint8Array(len)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}

/**
 * 读响应体, 按字节上限**流式**拦截并自带读超时。
 * guardedFetch 的连接超时在收到响应头后即解除, 故正文读必须独立设防 (否则 chunked / 无 Content-Length 的响应
 * 可绕过体积与超时双重保证 —— 红队确认的内存耗尽面)。先按 Content-Length 早拦, 再流式累计字节超限即中止。
 */
async function readCappedText(res: Response): Promise<string> {
  const len = res.headers.get("content-length")
  if (len && Number(len) > MAX_BODY_BYTES) throw new WebError("content-too-large", -32003)
  const body = res.body as ReadableStream<Uint8Array> | null
  if (!body || typeof body.getReader !== "function") {
    const t = await res.text() // 无流式 (某些实现): 退化到 text() + 事后长度兜底
    if (t.length > MAX_BODY_BYTES) throw new WebError("content-too-large", -32003)
    return t
  }
  const reader = body.getReader()
  let timedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    reader.cancel().catch(() => {})
  }, FETCH_TIMEOUT_MS)
  try {
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > MAX_BODY_BYTES) throw new WebError("content-too-large", -32003)
        chunks.push(value)
      }
    }
    return new TextDecoder("utf-8").decode(concatBytes(chunks))
  } catch (e) {
    if (e instanceof WebError) throw e
    throw new WebError(timedOut ? "timeout" : "fetch-failed", -32000)
  } finally {
    clearTimeout(deadline)
  }
}

// ── HTML → 文本 (regex, 无 DOMParser) ───────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return ""
  try {
    return String.fromCodePoint(n)
  } catch {
    return ""
  }
}

/** 行内片段 (标题/摘要) 去标签 + 解实体 + 压空白。 */
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

/** 整页 HTML → 可读纯文本 (剥 script/style, 块级转换行)。 */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|blockquote|pre)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return m ? clip(stripTags(m[1]), TITLE_CAP) : ""
}

function clip(s: string, n: number): string {
  const t = (s ?? "").trim()
  return t.length > n ? t.slice(0, n) : t
}

// ── web.fetch ─────────────────────────────────────────────────────────────────────────────────────

export interface WebFetchResult {
  url: string
  finalUrl: string
  title: string
  contentType: string
  text: string
  truncated: boolean
}

/** 抓取一个 https 链接, 回其可读正文文本 (截断到 maxChars)。违反 egress 策略/失败抛 WebError。 */
export async function webFetch(rawUrl: string, maxChars = DEFAULT_FETCH_CHARS): Promise<WebFetchResult> {
  const cap = Math.min(Math.max(Math.trunc(maxChars) || DEFAULT_FETCH_CHARS, 200), MAX_FETCH_CHARS)
  const r = await guardedFetch(rawUrl)
  if (!r.ok) throw new WebError("fetch-failed", -32000)
  const base = (r.contentType ?? "").split(";")[0].trim().toLowerCase()
  if (base && !ALLOWED_CONTENT_TYPES.has(base)) throw new WebError("unsupported-content-type", -32003)
  const raw = r.text
  const isHtml = base === "text/html" || base === "application/xhtml+xml" || /^\s*<(?:!doctype|html)/i.test(raw)
  const title = isHtml ? extractTitle(raw) : ""
  let text = isHtml ? htmlToText(raw) : raw.trim()
  const truncated = text.length > cap
  if (truncated) text = text.slice(0, cap)
  return { url: rawUrl, finalUrl: r.finalUrl, title, contentType: base, text, truncated }
}

// ── web.search (级联: DDG HTML 抓取 → DDG 即时答案 JSON → 维基 JSON → link-out 兜底) ──────────────────

export interface SearchResult {
  title: string
  url: string
  snippet: string
}
export interface WebSearchResult {
  query: string
  engine: string
  results: SearchResult[]
  /** 全级联失败/被限流时的非致命说明。 */
  note?: string
  /** 兜底可在浏览器打开的搜索结果页 (link-out floor)。 */
  serpUrl?: string
}

/** DDG 链接形如 //duckduckgo.com/l/?uddg=<编码目标>&rut=...; 取出真实目标 URL。 */
function unwrapDdg(href: string): string {
  const decoded = href.replace(/&amp;/gi, "&")
  try {
    const u = new URL(decoded, "https://duckduckgo.com")
    return u.searchParams.get("uddg") ?? u.href // searchParams.get 已解码一次
  } catch {
    return decoded
  }
}

function parseDdgHtml(html: string, limit: number): SearchResult[] {
  const links = [
    ...html.matchAll(
      /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ]
  const snippets = [
    ...html.matchAll(
      /<(?:a|div|td)\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/gi,
    ),
  ].map((m) => clip(stripTags(m[1]), SNIPPET_CAP))
  const out: SearchResult[] = []
  for (let i = 0; i < links.length && out.length < limit; i++) {
    const url = safeHref(unwrapDdg(links[i][1]))
    const title = clip(stripTags(links[i][2]), TITLE_CAP)
    if (!url || !title) continue
    out.push({ title, url, snippet: snippets[i] ?? "" })
  }
  return out
}

async function ddgHtmlSearch(query: string, limit: number): Promise<SearchResult[]> {
  const r = await guardedFetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "q=" + encodeURIComponent(query) + "&kl=wt-wt",
  })
  if (r.status === 202 || r.status === 429 || r.status === 403) return [] // 限流/反爬 → 级联下一档
  const html = r.text
  if (/anomalyDetectionBlock|\banomaly\b/i.test(html)) return []
  return parseDdgHtml(html, limit)
}

interface DdgRelated {
  Text?: string
  FirstURL?: string
  Topics?: DdgRelated[]
}
function flattenRelated(topics: DdgRelated[] | undefined): DdgRelated[] {
  const out: DdgRelated[] = []
  for (const t of topics ?? []) {
    if (Array.isArray(t.Topics)) out.push(...flattenRelated(t.Topics))
    else if (t.FirstURL && t.Text) out.push(t)
  }
  return out
}

async function ddgInstantAnswer(query: string, limit: number): Promise<SearchResult[]> {
  const r = await guardedFetch(
    "https://api.duckduckgo.com/?q=" + encodeURIComponent(query) + "&format=json&no_html=1&skip_disambig=1",
  )
  if (!r.ok) return []
  const data = JSON.parse(r.text) as {
    Heading?: string
    AbstractText?: string
    AbstractURL?: string
    RelatedTopics?: DdgRelated[]
  }
  const out: SearchResult[] = []
  if (data.AbstractText && data.AbstractURL) {
    const u = safeHref(data.AbstractURL)
    if (u) out.push({ title: clip(data.Heading || query, TITLE_CAP), url: u, snippet: clip(data.AbstractText, SNIPPET_CAP) })
  }
  for (const t of flattenRelated(data.RelatedTopics)) {
    if (out.length >= limit) break
    const u = safeHref(t.FirstURL)
    if (u && t.Text) out.push({ title: clip(t.Text, TITLE_CAP), url: u, snippet: clip(t.Text, SNIPPET_CAP) })
  }
  return out.slice(0, limit)
}

async function wikipediaSearch(query: string, limit: number): Promise<SearchResult[]> {
  const lang = /[一-鿿]/.test(query) ? "zh" : "en" // 含 CJK → 中文维基, 否则英文
  const r = await guardedFetch(
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*` +
      `&srlimit=${limit}&srsearch=` +
      encodeURIComponent(query),
  )
  if (!r.ok) return []
  const data = JSON.parse(r.text) as {
    query?: { search?: { title: string; snippet?: string }[] }
  }
  const out: SearchResult[] = []
  for (const h of data.query?.search ?? []) {
    if (out.length >= limit) break
    const url = safeHref(`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`)
    if (!url) continue
    out.push({ title: clip(h.title, TITLE_CAP), url, snippet: clip(stripTags(h.snippet ?? ""), SNIPPET_CAP) })
  }
  return out
}

/** 联网搜索: 级联多个免 key 数据源, 任一返回结果即用; 全失败退化为 link-out 提示。 */
export async function webSearch(query: string, limit = DEFAULT_SEARCH_LIMIT): Promise<WebSearchResult> {
  const q = query.trim()
  if (!q) throw new WebError("empty-query", -32602)
  const cap = Math.min(Math.max(Math.trunc(limit) || DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT)
  const tiers: [string, () => Promise<SearchResult[]>][] = [
    ["duckduckgo", () => ddgHtmlSearch(q, cap)],
    ["duckduckgo-ia", () => ddgInstantAnswer(q, cap)],
    ["wikipedia", () => wikipediaSearch(q, cap)],
  ]
  for (const [engine, run] of tiers) {
    try {
      const results = await run()
      if (results.length) return { query: q, engine, results: results.slice(0, cap) }
    } catch {
      // 单源失败 (限流/解析/网络) 不阻断级联, 试下一档。
    }
  }
  return {
    query: q,
    engine: "none",
    results: [],
    note: "实时网页结果暂不可用（可能被限流，或当前非 App 形态受 CORS 限制）；可在浏览器打开搜索结果页。",
    serpUrl: "https://duckduckgo.com/?q=" + encodeURIComponent(q),
  }
}
