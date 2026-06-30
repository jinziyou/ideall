// 官方 wonita 服务的 HTTP 适配器 —— `ServerPort` 的参考实现 (对接 wonita server)。
//
// **本文件是整个前端唯一允许 import wire DTO (`@/lib/api/server`, openapi 生成) 的地方**
// (由 eslint 强制)。业务代码一律用 `@protocol/server-port` 的领域类型。
// 同构: App 客户端直连 `NEXT_PUBLIC_SERVER_ADDR`, `pnpm dev` SSR 渲染期读 `SERVER_ADDR`
// (见 lib/env.ts)。
import { API_V1 } from "@/lib/env"
import { apiFetch, type ApiResult } from "@/lib/api"
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

// ── v1 响应包络: 所有 v1 端点统一返回 `{ data, meta? }` (见 wonita infra/response.rs)。 ──────────────
/** wonita v1 统一成功包络。`meta` 仅列表端点带 (分页/受限标记), 单资源端点省略。 */
type Enveloped<T> = { data: T; meta?: Wire["Meta"] | null }

/** 把 `{data, meta}` 包络的 ApiResult 解一层到 `data`; ok=false 透传, 空体 (204) → data:null。 */
function unwrap<T>(res: ApiResult<Enveloped<T>>): ApiResult<T> {
  if (!res.ok) return res
  return { ok: true, data: res.data ? res.data.data : null }
}

/** 文章不透明 id = base64url(url) (URL-safe 无填充), 与 wonita `decode_article_id` 对称。 */
function encodeArticleId(url: string): string {
  const bytes = new TextEncoder().encode(url)
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// ── 漂移门 (编译期, 零运行时): wire DTO 必须仍可赋给 ideall 领域类型。 ────────────────────────────
// wonita 服务改/删 ideall 依赖的字段 → `gen:api` 重生成 server.d.ts → 下面恒等映射的返回类型注解
// 编译失败 → CI 红。这是「契约权威在 ideall」落到类型层的硬保证。
// (InfoQuery→ArticleSearch 的漂移门见下方 `buildQueryBody` 的显式返回类型注解。)
const _contractGates = {
  info: (x: Wire["Info"]): Info => x,
  relatedInfo: (x: Wire["RelatedInfo"]): RelatedInfo => x,
  entityDetail: (x: Wire["EntityDetail"]): EntityDetail => x,
  peerPublisher: (x: Wire["PeerPublisher"]): PeerPublisher => x,
  publication: (x: Wire["Publication"]): Publication => x,
  publishDraft: (x: PublishDraft): Wire["NewPublication"] => x,
  authBody: (x: Wire["AuthBody"]): AuthBody => x,
  authCredentials: (x: AuthCredentials): Wire["AuthPayload"] => x,
  // GET /v1/auth/session 的 claims → CurrentUser: avatar 缺省归一为 null, 保持领域「avatar 必有」契约。
  currentUser: (x: Wire["UserClaimsData"]): CurrentUser => ({ ...x, avatar: x.avatar ?? null }),
}
void _contractGates

// ── 运行时语义门 (缓解「结构对、含义错」: 字段名/类型不变但单位漂移, 见 info-timestamp-unit-ms 约定) ──
/** 时间戳应为 epoch 毫秒。`0` 为「无时间」哨兵; 合法毫秒远大于 1e11 (秒级 ~1.7e9 会被识破)。 */
export function looksLikeMillis(t: number): boolean {
  return t === 0 || (Number.isFinite(t) && t > 1e11)
}

function warnIfNotMillis(where: string, t: number | undefined): void {
  if (process.env.NODE_ENV !== "production" && typeof t === "number" && !looksLikeMillis(t)) {
    console.warn(
      `[server-adapter] ${where} 时间戳疑似非毫秒 (got ${t}); wonita 服务契约要求 epoch 毫秒 (info-timestamp-unit-ms)`,
    )
  }
}

/** 默认分页: 单页 200 条 (= 服务端 limit 上限), 偏移 0 (历史口径)。 */
const DEFAULT_PAGE_SIZE_OFFSET: [number, number] = [200, 0]

/**
 * 领域 `InfoQuery` → wire `ArticleSearch` (POST /v1/articles/search 请求体)。
 * `page_size_offset` 元组拆成 `limit`/`offset` 两字段 (v1 契约口径)。
 * 返回类型显式标注 wire DTO = 编译期漂移门: wonita 改 ArticleSearch 字段 → gen:api 重生成 → 此处编译失败。
 */
function buildQueryBody(params: InfoQuery): Wire["ArticleSearch"] {
  const [limit, offset] = params.page_size_offset ?? DEFAULT_PAGE_SIZE_OFFSET
  return {
    entity_label_name: params.entity_label_name ?? null,
    publisher_domain: params.publisher_domain ?? null,
    timestamp_from_to: params.timestamp_from_to ?? null,
    limit,
    offset,
  }
}

export const httpServerAdapter: ServerPort = {
  async queryInfo(params) {
    // POST /v1/articles/search: 承载多实体过滤 (entity_label_name); 返回 {data:[Info], meta}。
    const res = unwrap(
      await apiFetch<Enveloped<Info[]>>(`${API_V1}/articles/search`, {
        method: "POST",
        json: buildQueryBody(params),
        cache: "no-store",
        defaultErrorMessage: "获取最新信息失败",
      }),
    )
    if (res.ok && res.data?.[0]) warnIfNotMillis("Info.collect_time", res.data[0].collect_time)
    return res
  },

  async getRelatedInfo(url) {
    const res = unwrap(
      await apiFetch<Enveloped<RelatedInfo[]>>(
        `${API_V1}/articles/${encodeArticleId(url)}/related`,
        { cache: "no-store", defaultErrorMessage: "获取关联信息失败" },
      ),
    )
    if (!res.ok) {
      console.error("[getRelatedInfo]", res.message)
      return []
    }
    return Array.isArray(res.data) ? res.data : []
  },

  async getInfo(url) {
    // 返回完整 ApiResult: 调用方 (全面报道整页) 须区分「取数失败 (可重试)」与「真不存在 (data:null)」。
    // GET /v1/articles/{id} 命中 200{data}, 不存在 404 —— 故 404 归一为 ok:true & data:null。
    const res = await apiFetch<Enveloped<Info>>(`${API_V1}/articles/${encodeArticleId(url)}`, {
      cache: "no-store",
      defaultErrorMessage: "获取信息详情失败",
    })
    if (!res.ok) return res.status === 404 ? { ok: true, data: null } : res
    return { ok: true, data: res.data ? res.data.data : null }
  },

  async getEntityDetail(label, name) {
    // GET /v1/entities/{label}/{name}: 实体不存在时服务端回 200 且 mention_count=0 (非 404)。
    const res = unwrap(
      await apiFetch<Enveloped<EntityDetail>>(
        `${API_V1}/entities/${encodeURIComponent(label)}/${encodeURIComponent(name)}`,
        { cache: "no-store", defaultErrorMessage: "获取实体详情失败" },
      ),
    )
    if (!res.ok) {
      console.error("[getEntityDetail]", res.message)
      return null
    }
    return res.data
  },

  async listPeers() {
    return unwrap(
      await apiFetch<Enveloped<PeerPublisher[]>>(`${API_V1}/peers`, {
        cache: "no-store",
        defaultErrorMessage: "获取社区发布者失败",
      }),
    )
  },

  async getPeerPublications(id) {
    const res = unwrap(
      await apiFetch<Enveloped<Publication[]>>(
        `${API_V1}/peers/${encodeURIComponent(id)}/publications`,
        { cache: "no-store", defaultErrorMessage: "获取发布失败" },
      ),
    )
    if (res.ok && res.data?.[0]) warnIfNotMillis("Publication.created_at", res.data[0].created_at)
    return res
  },

  async publish(token, draft) {
    return unwrap(
      await apiFetch<Enveloped<Publication>>(`${API_V1}/me/publications`, {
        method: "POST",
        json: { title: draft.title, url: draft.url ?? "", body: draft.body ?? "" },
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        defaultErrorMessage: "发布失败",
      }),
    )
  },

  async deletePublication(token, id) {
    return apiFetch(`${API_V1}/me/publications/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      defaultErrorMessage: "删除失败",
    })
  },

  async getServerPublicKey(clientId): Promise<ApiResult<string>> {
    // GET /v1/auth/handshake/{clientId} → {data:{public_key}} (hex)。apiFetch 已经 resolveFetch 绕 CORS。
    const res = unwrap(
      await apiFetch<Enveloped<Wire["Handshake"]>>(
        `${API_V1}/auth/handshake/${encodeURIComponent(clientId)}`,
        { cache: "no-store", defaultErrorMessage: "获取密钥失败，请重试" },
      ),
    )
    if (!res.ok) return res
    const key = res.data?.public_key
    return key ? { ok: true, data: key } : { ok: false, message: "获取密钥失败，请重试" }
  },

  async login(payload) {
    return unwrap(
      await apiFetch<Enveloped<AuthBody>>(`${API_V1}/auth/login`, {
        method: "POST",
        json: payload,
        cache: "no-store",
        defaultErrorMessage: "登录失败",
      }),
    )
  },

  async register(payload) {
    return unwrap(
      await apiFetch<Enveloped<AuthBody>>(`${API_V1}/auth/register`, {
        method: "POST",
        json: payload,
        cache: "no-store",
        defaultErrorMessage: "注册失败",
      }),
    )
  },

  async getMe(token) {
    // GET /v1/auth/session → {data: UserClaimsData}; 映射到 CurrentUser (avatar 缺省归一为 null)。
    const res = await apiFetch<Enveloped<Wire["UserClaimsData"]>>(`${API_V1}/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      defaultErrorMessage: "获取用户信息失败",
    })
    if (!res.ok) return res
    const u = res.data?.data
    return {
      ok: true,
      data: u ? { id: u.id, email: u.email, name: u.name, avatar: u.avatar ?? null } : null,
    }
  },

  async updateProfile(token, patch) {
    // PUT /v1/me/profile —— apiserver 仅支持改 name (见 ProfileUpdate); avatar 预留。204 无响应体。
    // 漂移门: 请求体显式标注 Wire["ProfileUpdate"] (同 buildQueryBody 口径) —— wonita 改 profile
    // 字段 (改名/加必填) → gen:api 重生成 → 此处编译失败 → CI 红, 杜绝漂移静默逃逸到运行时。
    const body: Wire["ProfileUpdate"] = { name: patch.name ?? "" }
    return apiFetch(`${API_V1}/me/profile`, {
      method: "PUT",
      json: body,
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      defaultErrorMessage: "更新资料失败",
    })
  },
}
