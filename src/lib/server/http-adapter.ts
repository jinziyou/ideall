// 官方 wonita 服务的 HTTP 适配器 —— `ServerPort` 的参考实现。
//
// **本文件是整个前端唯一允许 import wire DTO (`@/lib/api/server`, OpenAPI 生成) 的地方**
// (由 eslint 强制)。业务代码一律使用 `@protocol/server-port` 的领域类型。
//
// V2 App 端点承载 auth/community/profile 读写；V2 Data 的 corpus/graph/catalog 端点可匿名
// 直连。匿名 corpus query 单次最多 50 条，适配器用 cursor 串联来保留领域层旧有
// offset 语义，不向 renderer 暴露 service token。
import { API_V2_APP, API_V2_DATA } from "@/lib/env"
import type { ApiResult } from "@protocol/api-result"
import { apiFetch } from "@/lib/api"
import type { components } from "@/lib/api/server"
import type {
  ServerPort,
  Info,
  RelatedInfo,
  EntityDetail,
  InfoQuery,
  PeerPublisher,
  Publication,
  PublishDraft,
  AuthBody,
  AuthCredentials,
  CurrentUser,
} from "@protocol/server-port"

type Wire = components["schemas"]
type V2Envelope<T> = { data: T; meta: Wire["V2Meta"] }

const PUBLIC_QUERY_LIMIT = 50
const DOMAIN_QUERY_LIMIT = 200
const MAX_CURSOR_REQUESTS = 200

/** V2 session claims → ideall 当前用户。avatar 在 V2 无写入来源，领域边界统一补 null。 */
export function normalizeCurrentUser(x: Wire["V2AppClaimsData"]): CurrentUser {
  return {
    id: x.account_id,
    email: x.email,
    name: x.display_name,
    avatar: null,
  }
}

/** V2 稳定文章 ID 使用的 URL 规范化，与 wonita `v2::ids::canonical_url` 对齐。 */
export function canonicalArticleUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl.trim())
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("文章 URL 必须使用 http(s)")
  }
  if (parsed.username || parsed.password) {
    throw new TypeError("文章 URL 不得包含凭证")
  }
  // WHATWG URL 已处理 IDNA、主机名小写、默认端口与空路径；wonita 额外去掉域名尾点。
  parsed.hostname = parsed.hostname.replace(/\.$/, "")
  parsed.hash = ""
  return parsed.toString()
}

/** `a:<sha256(canonical URL)>`，不再使用 V1 的 base64url(raw URL) 临时 ID。 */
export async function articleIdV2(rawUrl: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("当前运行时不支持 SHA-256")
  const canonical = canonicalArticleUrl(rawUrl)
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  )
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )
  return `a:${hex}`
}

function utcWeekStart(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return timestamp
  const date = new Date(timestamp)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.getTime()
}

function utcMonthStart(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return timestamp
  const date = new Date(timestamp)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

export function articleFromV2(article: Wire["V2DataArticle"]): Info {
  return {
    url: article.canonical_url,
    title: article.title,
    data: article.body,
    language: article.language,
    labels: (article.entities ?? []).map((entity) => ({
      label: entity.label,
      name: entity.surface || entity.canonical_name,
      period: utcWeekStart(article.collected_at_ms),
      // mention DTO 不携带词条目录字段；详情页会通过 entity catalog 获得真实值。
      has_entry: false,
      wikipedia_url: null,
    })),
    publisher: {
      domain: article.publisher_domain,
      // article DTO 只携带 domain；发布者名称在 catalog 详情中。
      name: article.publisher_domain,
      period: utcMonthStart(article.collected_at_ms),
    },
    collect_time: article.collected_at_ms,
    publish_time: article.published_at_ms,
  }
}

export function publicationFromV2(value: Wire["V2AppPublication"]): Publication {
  return {
    id: value.publication_id,
    title: value.title,
    url: value.url,
    body: value.body,
    created_at: value.created_at_ms,
  }
}

export function peerPublisherFromV2(value: Wire["V2AppPublicAccount"]): PeerPublisher {
  return {
    id: value.account_id,
    name: value.display_name,
    publication_count: value.publication_count,
  }
}

function relatedInfoFromV2(value: Wire["V2DataRelatedArticle"]): RelatedInfo {
  return {
    ...articleFromV2(value.article),
    shared: value.shared_entities,
    // V2 graph 已给出综合 score，但不再单独返回「有词条的共享实体数」。
    shared_entry: 0,
  }
}

function entityDetailFromV2(
  entity: Wire["V2DataEntityDetail"],
  neighbors: Wire["V2DataEntityNeighbor"][],
): EntityDetail {
  return {
    label: entity.label,
    name: entity.canonical_name,
    mention_count: entity.mention_count,
    first_seen: entity.first_seen_ms,
    last_seen: entity.last_seen_ms,
    has_entry: entity.has_entry,
    wikipedia_url: entity.wikipedia_url,
    co_entities: neighbors.map((neighbor) => ({
      label: neighbor.entity.label,
      name: neighbor.entity.canonical_name,
      count: neighbor.shared_articles,
      has_entry: neighbor.entity.has_entry,
    })),
    weekly: entity.weekly.map((period) => ({
      count: period.mention_count,
      period: period.period_ms,
    })),
  }
}

function withQuery(url: string, query: URLSearchParams): string {
  const value = query.toString()
  return value ? `${url}?${value}` : url
}

function requiredEnvelope<T>(
  result: ApiResult<V2Envelope<T>>,
  invalidMessage = "服务端返回了无效的 V2 响应",
): ApiResult<V2Envelope<T>> {
  if (!result.ok || result.data) return result
  return { ok: false, message: invalidMessage }
}

function unwrapV2<T, R>(result: ApiResult<V2Envelope<T>>, map: (value: T) => R): ApiResult<R> {
  const checked = requiredEnvelope(result)
  if (!checked.ok) return checked
  return { ok: true, data: checked.data ? map(checked.data.data) : null }
}

async function findV2Publisher(domain: string): Promise<Wire["V2DataPublisher"] | null> {
  const query = new URLSearchParams({ q: domain, limit: "20" })
  const result = requiredEnvelope(
    await apiFetch<V2Envelope<Wire["V2DataPublisher"][]>>(
      withQuery(`${API_V2_DATA}/catalog/publishers`, query),
      { cache: "no-store", defaultErrorMessage: "解析发布者失败" },
    ),
  )
  if (!result.ok) throw new Error(result.message)
  const normalized = domain.trim().replace(/\.$/, "").toLowerCase()
  return (
    result.data?.data.find((publisher) => publisher.domain.toLowerCase() === normalized) ?? null
  )
}

async function findV2Entity(label: string, name: string): Promise<Wire["V2DataEntity"] | null> {
  const query = new URLSearchParams({ q: name, limit: "50" })
  const result = requiredEnvelope(
    await apiFetch<V2Envelope<Wire["V2DataEntity"][]>>(
      withQuery(`${API_V2_DATA}/graph/entities`, query),
      { cache: "no-store", defaultErrorMessage: "解析实体失败" },
    ),
  )
  if (!result.ok) throw new Error(result.message)
  const normalizedLabel = label.trim().toUpperCase()
  const normalizedName = name.trim().toLocaleLowerCase()
  return (
    result.data?.data.find(
      (entity) =>
        entity.label.trim().toUpperCase() === normalizedLabel &&
        [entity.canonical_name, entity.display_name]
          .map((candidate) => candidate.trim().toLocaleLowerCase())
          .includes(normalizedName),
    ) ?? null
  )
}

async function buildV2ArticleBody(params: InfoQuery): Promise<Wire["V2DataArticleQuery"]> {
  const body: Wire["V2DataArticleQuery"] = {}
  if (params.timestamp_from_to) {
    body.from_ms = params.timestamp_from_to[0]
    body.to_ms = params.timestamp_from_to[1]
  }
  if (params.publisher_domain) {
    const publisher = await findV2Publisher(params.publisher_domain)
    if (!publisher) throw new Error("V2 发布者目录中不存在该域名")
    body.publisher_id = publisher.publisher_id
  }
  if (params.entity_label_name?.length) {
    const entities = await Promise.all(
      params.entity_label_name.map(([label, name]) => findV2Entity(label, name)),
    )
    if (entities.some((entity) => entity === null)) {
      throw new Error("V2 实体目录中不存在筛选项")
    }
    body.entity_ids = entities.map((entity) => entity!.entity_id)
  }
  return body
}

function pageWindow(params: InfoQuery): { size: number; offset: number } {
  const [rawSize, rawOffset] = params.page_size_offset ?? [DOMAIN_QUERY_LIMIT, 0]
  const size = Number.isFinite(rawSize)
    ? Math.min(DOMAIN_QUERY_LIMIT, Math.max(1, Math.trunc(rawSize)))
    : DOMAIN_QUERY_LIMIT
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0
  return { size, offset }
}

// ── 运行时语义门：时间戳必须保持 epoch 毫秒。 ─────────────────────────────────
export function looksLikeMillis(t: number): boolean {
  return t === 0 || (Number.isFinite(t) && t > 1e11)
}

function warnIfNotMillis(where: string, t: number | undefined): void {
  if (process.env.NODE_ENV !== "production" && typeof t === "number" && !looksLikeMillis(t)) {
    console.warn(
      `[server-adapter] ${where} 时间戳疑似非毫秒 (got ${t}); wonita V2 接口要求 epoch 毫秒`,
    )
  }
}

// ── 编译期漂移门：生成 DTO 变化会在显式映射/请求体处使 typecheck 失败。 ────────────────
const _contractGates = {
  article: articleFromV2,
  publication: publicationFromV2,
  peerPublisher: peerPublisherFromV2,
  currentUser: normalizeCurrentUser,
  authBody: (value: Wire["AuthBody"]): AuthBody => value,
  authCredentials: (value: AuthCredentials): Wire["AuthPayload"] => value,
  publishDraft: (value: PublishDraft): Wire["V2AppNewPublication"] => ({
    title: value.title,
    url: value.url ?? "",
    body: value.body ?? "",
  }),
}
void _contractGates

export const httpServerAdapter: ServerPort = {
  async queryInfo(params) {
    try {
      const baseBody = await buildV2ArticleBody(params)
      const { size, offset } = pageWindow(params)
      // limit 必须在整条 cursor 链上保持一致（它参与服务端 filter hash）。
      const requestLimit = Math.min(PUBLIC_QUERY_LIMIT, Math.max(1, size + offset))
      let remainingSkip = offset
      const output: Info[] = []
      let cursor: string | undefined
      const seenCursors = new Set<string>()

      for (let request = 0; request < MAX_CURSOR_REQUESTS; request += 1) {
        const body: Wire["V2DataArticleQuery"] = {
          ...baseBody,
          limit: requestLimit,
          ...(cursor ? { cursor } : {}),
        }
        const result = requiredEnvelope(
          await apiFetch<V2Envelope<Wire["V2DataArticle"][]>>(
            `${API_V2_DATA}/corpus/articles/query`,
            {
              method: "POST",
              json: body,
              cache: "no-store",
              defaultErrorMessage: "获取最新信息失败",
            },
          ),
        )
        if (!result.ok) return result
        const envelope = result.data!
        const rows = envelope.data
        const start = Math.min(remainingSkip, rows.length)
        remainingSkip -= start
        if (remainingSkip === 0 && output.length < size) {
          output.push(...rows.slice(start, start + size - output.length).map(articleFromV2))
        }
        if (output.length >= size || !envelope.meta.has_more) {
          if (output[0]) warnIfNotMillis("Info.collect_time", output[0].collect_time)
          return { ok: true, data: output }
        }
        const next = envelope.meta.next_cursor
        if (!next || seenCursors.has(next)) {
          return { ok: false, message: "服务端返回了无效的文章分页游标" }
        }
        seenCursors.add(next)
        cursor = next
      }
      return { ok: false, message: "文章分页过深，请收窄查询条件" }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "V2 查询参数无效",
      }
    }
  },

  async getRelatedInfo(url) {
    try {
      const id = await articleIdV2(url)
      const result = requiredEnvelope(
        await apiFetch<V2Envelope<Wire["V2DataRelatedArticle"][]>>(
          `${API_V2_DATA}/graph/articles/${encodeURIComponent(id)}/related`,
          { cache: "no-store", defaultErrorMessage: "获取关联信息失败" },
        ),
      )
      if (!result.ok) {
        console.error("[getRelatedInfo]", result.message)
        return []
      }
      return result.data!.data.map(relatedInfoFromV2)
    } catch (error) {
      console.error("[getRelatedInfo]", error)
      return []
    }
  },

  async getInfo(url) {
    let id: string
    try {
      id = await articleIdV2(url)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "文章 URL 无效" }
    }
    const result = await apiFetch<V2Envelope<Wire["V2DataArticle"]>>(
      `${API_V2_DATA}/corpus/articles/${encodeURIComponent(id)}`,
      { cache: "no-store", defaultErrorMessage: "获取信息详情失败" },
    )
    if (!result.ok) return result.status === 404 ? { ok: true, data: null } : result
    if (!result.data) return { ok: false, message: "服务端返回了无效的文章详情" }
    const info = articleFromV2(result.data.data)
    warnIfNotMillis("Info.collect_time", info.collect_time)
    return { ok: true, data: info }
  },

  async getEntityDetail(label, name) {
    try {
      const matched = await findV2Entity(label, name)
      if (!matched) return null
      const [entityResult, neighborResult] = await Promise.all([
        apiFetch<V2Envelope<Wire["V2DataEntityDetail"]>>(
          `${API_V2_DATA}/graph/entities/${encodeURIComponent(matched.entity_id)}`,
          { cache: "no-store", defaultErrorMessage: "获取实体详情失败" },
        ),
        apiFetch<V2Envelope<Wire["V2DataEntityNeighbor"][]>>(
          withQuery(
            `${API_V2_DATA}/graph/entities/${encodeURIComponent(matched.entity_id)}/neighbors`,
            new URLSearchParams({ limit: "20" }),
          ),
          { cache: "no-store", defaultErrorMessage: "获取相关实体失败" },
        ),
      ])
      const detail = requiredEnvelope(entityResult)
      if (!detail.ok) {
        console.error("[getEntityDetail]", detail.message)
        return null
      }
      const neighbors = requiredEnvelope(neighborResult)
      return entityDetailFromV2(detail.data!.data, neighbors.ok ? (neighbors.data?.data ?? []) : [])
    } catch (error) {
      console.error("[getEntityDetail]", error)
      return null
    }
  },

  async listPeers() {
    const peers: PeerPublisher[] = []
    let cursor: string | undefined
    const seenCursors = new Set<string>()
    for (let request = 0; request < MAX_CURSOR_REQUESTS; request += 1) {
      const query = new URLSearchParams({ limit: "100" })
      if (cursor) query.set("cursor", cursor)
      const result = requiredEnvelope(
        await apiFetch<V2Envelope<Wire["V2AppPublicAccount"][]>>(
          withQuery(`${API_V2_APP}/community/accounts`, query),
          { cache: "no-store", defaultErrorMessage: "获取社区发布者失败" },
        ),
      )
      if (!result.ok) return result
      peers.push(...result.data!.data.map(peerPublisherFromV2))
      if (!result.data!.meta.has_more) return { ok: true, data: peers }
      const next = result.data!.meta.next_cursor
      if (!next || seenCursors.has(next)) {
        return { ok: false, message: "服务端返回了无效的账户分页游标" }
      }
      seenCursors.add(next)
      cursor = next
    }
    return { ok: false, message: "账户目录分页过深" }
  },

  async getPeerPublications(id) {
    const result = unwrapV2(
      await apiFetch<V2Envelope<Wire["V2AppPublication"][]>>(
        `${API_V2_APP}/community/accounts/${encodeURIComponent(id)}/publications`,
        { cache: "no-store", defaultErrorMessage: "获取发布失败" },
      ),
      (values) => values.map(publicationFromV2),
    )
    if (result.ok && result.data?.[0]) {
      warnIfNotMillis("Publication.created_at", result.data[0].created_at)
    }
    return result
  },

  async publish(token, draft) {
    const body: Wire["V2AppNewPublication"] = {
      title: draft.title,
      url: draft.url ?? "",
      body: draft.body ?? "",
    }
    return unwrapV2(
      await apiFetch<V2Envelope<Wire["V2AppPublication"]>>(`${API_V2_APP}/me/publications`, {
        method: "POST",
        json: body,
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        defaultErrorMessage: "发布失败",
      }),
      publicationFromV2,
    )
  },

  async deletePublication(token, id) {
    return apiFetch(`${API_V2_APP}/me/publications/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      defaultErrorMessage: "删除失败",
    })
  },

  async getServerPublicKey(clientId): Promise<ApiResult<string>> {
    const result = unwrapV2(
      await apiFetch<V2Envelope<Wire["Handshake"]>>(
        `${API_V2_APP}/auth/handshake/${encodeURIComponent(clientId)}`,
        { cache: "no-store", defaultErrorMessage: "获取密钥失败，请重试" },
      ),
      (value) => value.public_key,
    )
    if (!result.ok) return result
    return result.data ? result : { ok: false, message: "获取密钥失败，请重试" }
  },

  async login(payload) {
    const body: Wire["AuthPayload"] = payload
    return unwrapV2(
      await apiFetch<V2Envelope<Wire["AuthBody"]>>(`${API_V2_APP}/auth/login`, {
        method: "POST",
        json: body,
        cache: "no-store",
        defaultErrorMessage: "登录失败",
      }),
      (value): AuthBody => value,
    )
  },

  async register(payload) {
    const body: Wire["AuthPayload"] = payload
    return unwrapV2(
      await apiFetch<V2Envelope<Wire["AuthBody"]>>(`${API_V2_APP}/auth/register`, {
        method: "POST",
        json: body,
        cache: "no-store",
        defaultErrorMessage: "注册失败",
      }),
      (value): AuthBody => value,
    )
  },

  async getMe(token) {
    return unwrapV2(
      await apiFetch<V2Envelope<Wire["V2AppClaimsData"]>>(`${API_V2_APP}/auth/session`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        defaultErrorMessage: "获取用户信息失败",
      }),
      normalizeCurrentUser,
    )
  },

  async updateProfile(token, patch) {
    const displayName = patch.name.trim()
    if (!displayName || [...displayName].length > 100) {
      return { ok: false, status: 400, message: "发布名称必须为 1–100 个字符" }
    }
    const body: Wire["V2AppProfileUpdate"] = { display_name: displayName }
    return unwrapV2(
      await apiFetch<V2Envelope<Wire["V2AppClaimsData"]>>(`${API_V2_APP}/me/profile`, {
        method: "PUT",
        json: body,
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        defaultErrorMessage: "更新资料失败",
      }),
      normalizeCurrentUser,
    )
  },
}
