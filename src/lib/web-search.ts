// agent 联网能力 (web.search / web.fetch) 的纯逻辑实现 —— lib 叶子。
//
// 经 MCP 统一能力层 (src/plugins/embed/tools.ts) 注册供 agent (loopback) 调用; 是 `/tool` 模块「返回数据」化的核心:
// 把原先只 link-out 的搜索升级为真·抓取并把结果回喂模型。放在 lib 是因为 (a) plugins 与 modules 都可无边界依赖,
// (b) 它的依赖 (./egress-guard 的 guardedFetch、@/lib/safe-url 的 safeHref) 本就在 lib, (c) 纯逻辑无 React/DOM,
// 可在 webview 与 `node --test` 同构运行 (故 HTML 解析用 regex 而非 DOMParser —— node 测试环境无 DOM)。
//
// egress 守卫 (SSRF/DNS-rebind/元数据外泄 防护) 已抽到 ./egress-guard (供 egress-guard.test.ts 隔离覆盖);
// 安全姿态详见该文件头部。出站一律经 guardedFetch (内部强制单一收口 + 逐跳重定向复检 + 体积/超时上限)。
import { WebError, guardedFetch } from "./egress-guard"
import { safeHref } from "@/lib/safe-url"

// WebError 经此 re-export, 既有消费方 (embed/tools.ts) 仍从 @/lib/web-search import。
export { WebError } from "./egress-guard"

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
  return decodeEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
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
export async function webFetch(
  rawUrl: string,
  maxChars = DEFAULT_FETCH_CHARS,
): Promise<WebFetchResult> {
  const cap = Math.min(Math.max(Math.trunc(maxChars) || DEFAULT_FETCH_CHARS, 200), MAX_FETCH_CHARS)
  const r = await guardedFetch(rawUrl)
  if (!r.ok) throw new WebError("fetch-failed", -32000)
  const base = (r.contentType ?? "").split(";")[0].trim().toLowerCase()
  if (base && !ALLOWED_CONTENT_TYPES.has(base))
    throw new WebError("unsupported-content-type", -32003)
  const raw = r.text
  const isHtml =
    base === "text/html" || base === "application/xhtml+xml" || /^\s*<(?:!doctype|html)/i.test(raw)
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
    "https://api.duckduckgo.com/?q=" +
      encodeURIComponent(query) +
      "&format=json&no_html=1&skip_disambig=1",
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
    if (u)
      out.push({
        title: clip(data.Heading || query, TITLE_CAP),
        url: u,
        snippet: clip(data.AbstractText, SNIPPET_CAP),
      })
  }
  for (const t of flattenRelated(data.RelatedTopics)) {
    if (out.length >= limit) break
    const u = safeHref(t.FirstURL)
    if (u && t.Text)
      out.push({ title: clip(t.Text, TITLE_CAP), url: u, snippet: clip(t.Text, SNIPPET_CAP) })
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
    const url = safeHref(
      `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
    )
    if (!url) continue
    out.push({
      title: clip(h.title, TITLE_CAP),
      url,
      snippet: clip(stripTags(h.snippet ?? ""), SNIPPET_CAP),
    })
  }
  return out
}

/** 联网搜索: 级联多个免 key 数据源, 任一返回结果即用; 全失败退化为 link-out 提示。 */
export async function webSearch(
  query: string,
  limit = DEFAULT_SEARCH_LIMIT,
): Promise<WebSearchResult> {
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
