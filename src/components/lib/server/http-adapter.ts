// 官方 wonita 服务的 HTTP 适配器 —— `ServerPort` 的参考实现 (对接 wonita server)。
//
// **本文件是整个前端唯一允许 import wire DTO (`@/components/lib/api/server`, openapi 生成) 的地方**
// (由 eslint 强制)。业务代码一律用 `@protocol/server-port` 的领域类型。
// 同构: App 客户端直连 `NEXT_PUBLIC_SERVER_ADDR`, `pnpm dev` SSR 渲染期读 `SERVER_ADDR`
// (见 lib/env.ts)。
import { SERVER_ADDR, INFO_API_URI } from "@/components/lib/env"
import { apiFetch, type ApiResult } from "@/components/lib/api"
import { resolveFetch } from "@/components/lib/tauri"
import type { components } from "@/components/lib/api/server"
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
const AUTH = `${SERVER_ADDR}/authorize`

// ── 漂移门 (编译期, 零运行时): wire DTO 必须仍可赋给 ideall 领域类型。 ────────────────────────────
// wonita 服务改/删 ideall 依赖的字段 → `gen:api` 重生成 server.d.ts → 下面恒等映射的返回类型注解
// 编译失败 → CI 红。这是「契约权威在 ideall」落到类型层的硬保证。
const _contractGates = {
  info: (x: Wire["Info"]): Info => x,
  relatedInfo: (x: Wire["RelatedInfo"]): RelatedInfo => x,
  entityDetail: (x: Wire["EntityDetail"]): EntityDetail => x,
  infoQuery: (x: InfoQuery): Wire["QueryInfoParams"] => x,
  peerPublisher: (x: Wire["PeerPublisher"]): PeerPublisher => x,
  publication: (x: Wire["Publication"]): Publication => x,
  publishDraft: (x: PublishDraft): Wire["NewPublication"] => x,
  authBody: (x: Wire["AuthBody"]): AuthBody => x,
  authCredentials: (x: AuthCredentials): Wire["AuthPayload"] => x,
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

/** 默认分页: 单页 200 条, 偏移 0 (历史口径)。 */
const DEFAULT_PAGE_SIZE_OFFSET: [number, number] = [200, 0]

function buildQueryBody(params: InfoQuery): Wire["QueryInfoParams"] {
  return { ...params, page_size_offset: params.page_size_offset ?? DEFAULT_PAGE_SIZE_OFFSET }
}

export const httpServerAdapter: ServerPort = {
  async queryInfo(params) {
    const res = await apiFetch<Info[]>(`${INFO_API_URI}`, {
      method: "POST",
      json: buildQueryBody(params),
      cache: "no-store",
      defaultErrorMessage: "获取最新信息失败",
    })
    if (res.ok && res.data?.[0]) warnIfNotMillis("Info.collect_time", res.data[0].collect_time)
    return res
  },

  async getRelatedInfo(url) {
    const qs = new URLSearchParams({ url })
    const res = await apiFetch<RelatedInfo[]>(`${INFO_API_URI}/analysis?${qs}`, {
      cache: "no-store",
      defaultErrorMessage: "获取关联信息失败",
    })
    if (!res.ok) {
      console.error("[getRelatedInfo]", res.message)
      return []
    }
    return Array.isArray(res.data) ? res.data : []
  },

  async getInfo(url) {
    // 返回完整 ApiResult: 调用方 (全面报道整页) 须区分「取数失败 (可重试)」与「真不存在 (data:null)」。
    const qs = new URLSearchParams({ url })
    return apiFetch<Info>(`${INFO_API_URI}?${qs}`, {
      cache: "no-store",
      defaultErrorMessage: "获取信息详情失败",
    })
  },

  async getEntityDetail(label, name) {
    const qs = new URLSearchParams({ label, name })
    const res = await apiFetch<EntityDetail>(`${INFO_API_URI}/entity?${qs}`, {
      cache: "no-store",
      defaultErrorMessage: "获取实体详情失败",
    })
    if (!res.ok) {
      console.error("[getEntityDetail]", res.message)
      return null
    }
    return res.data
  },

  async listPeers() {
    return apiFetch<PeerPublisher[]>(`${SERVER_ADDR}/peers`, {
      cache: "no-store",
      defaultErrorMessage: "获取社区发布者失败",
    })
  },

  async getPeerPublications(id) {
    const res = await apiFetch<Publication[]>(
      `${SERVER_ADDR}/peer/${encodeURIComponent(id)}/publications`,
      { cache: "no-store", defaultErrorMessage: "获取发布失败" },
    )
    if (res.ok && res.data?.[0]) warnIfNotMillis("Publication.created_at", res.data[0].created_at)
    return res
  },

  async publish(token, draft) {
    return apiFetch<Publication>(`${SERVER_ADDR}/me/publications`, {
      method: "POST",
      json: { title: draft.title, url: draft.url ?? "", body: draft.body ?? "" },
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      defaultErrorMessage: "发布失败",
    })
  },

  async deletePublication(token, id) {
    return apiFetch(`${SERVER_ADDR}/me/publications/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      defaultErrorMessage: "删除失败",
    })
  },

  async getServerPublicKey(clientId): Promise<ApiResult<string>> {
    // GET /authorize/secret/{clientId} 返回裸 hex 字符串 (非 JSON), 故用裸 fetch (经 resolveFetch 绕 CORS)。
    try {
      const httpFetch = await resolveFetch()
      const r = await httpFetch(`${AUTH}/secret/${encodeURIComponent(clientId)}`, {
        cache: "no-store",
      })
      const text = (await r.text()).trim()
      if (!r.ok) return { ok: false, status: r.status, message: text || "获取密钥失败，请重试" }
      return { ok: true, data: text }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? `网络错误：${e.message}` : "网络错误" }
    }
  },

  async login(payload) {
    return apiFetch<AuthBody>(`${AUTH}/login`, {
      method: "POST",
      json: payload,
      cache: "no-store",
      defaultErrorMessage: "登录失败",
    })
  },

  async register(payload) {
    return apiFetch<AuthBody>(`${AUTH}/register`, {
      method: "POST",
      json: payload,
      cache: "no-store",
      defaultErrorMessage: "注册失败",
    })
  },

  async getMe(token) {
    return apiFetch<CurrentUser>(`${AUTH}/authorize`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      defaultErrorMessage: "获取用户信息失败",
    })
  },

  async updateProfile(token, patch) {
    // PUT /me/profile —— apiserver 仅支持改 name (见 ProfileUpdate); avatar 预留。
    // 漂移门: 请求体显式标注 Wire["ProfileUpdate"] (同 buildQueryBody 口径) —— wonita 改 profile
    // 字段 (改名/加必填) → gen:api 重生成 → 此处编译失败 → CI 红, 杜绝漂移静默逃逸到运行时。
    const body: Wire["ProfileUpdate"] = { name: patch.name ?? "" }
    return apiFetch(`${SERVER_ADDR}/me/profile`, {
      method: "PUT",
      json: body,
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      defaultErrorMessage: "更新资料失败",
    })
  },
}
