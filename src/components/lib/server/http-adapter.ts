// 官方 super-node 的 HTTP 适配器 —— `ServerPort` 的参考实现 (对接 wonita super/server)。
//
// **本文件是整个前端唯一允许 import wire DTO (`@/components/lib/api/server`, openapi 生成) 的地方**
// (由 eslint 强制)。业务代码一律用 `@protocol/server-port` 的领域类型。
// 同构: web SSR 读 `SERVER_ADDR`, web 浏览器走同源 `/api/backend` 代理, app 直连
// `NEXT_PUBLIC_SERVER_ADDR` (见 lib/env.ts)。
import { SERVER_ADDR, INFO_API_URI } from "@/components/lib/env"
import { apiFetch, type ApiResult } from "@/components/lib/api"
import type { components } from "@/components/lib/api/server"
import type {
  ServerPort,
  Info,
  InfoEvent,
  RelatedInfo,
  EntityDetail,
  EntityStats,
  InfoQuery,
  IpLocation,
  PublisherLocation,
  PeerPublisher,
  Publication,
  PublishDraft,
  AuthBody,
  AuthCredentials,
  CurrentUser,
} from "@protocol/server-port"

type Wire = components["schemas"]
const AUTH = `${SERVER_ADDR}/authorize`

// ── 漂移门 (编译期, 零运行时): wire DTO 必须仍可赋给 myos 领域类型。 ────────────────────────────
// super/server 改/删 myos 依赖的字段 → `gen:api` 重生成 server.d.ts → 下面恒等映射的返回类型注解
// 编译失败 → CI 红。这是「契约权威在 myos」落到类型层的硬保证。
const _contractGates = {
  info: (x: Wire["Info"]): Info => x,
  infoEvent: (x: Wire["InfoEvent"]): InfoEvent => x,
  relatedInfo: (x: Wire["RelatedInfo"]): RelatedInfo => x,
  entityDetail: (x: Wire["EntityDetail"]): EntityDetail => x,
  entityStats: (x: Wire["EntityStats"]): EntityStats => x,
  infoQuery: (x: InfoQuery): Wire["QueryInfoParams"] => x,
  ipLocation: (x: Wire["IpLocation"]): IpLocation => x,
  publisherLocation: (x: Wire["PublisherLocation"]): PublisherLocation => x,
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
      `[server-adapter] ${where} 时间戳疑似非毫秒 (got ${t}); super/server 契约要求 epoch 毫秒 (info-timestamp-unit-ms)`,
    )
  }
}

/** 默认分页: 单页 200 条, 偏移 0 (历史口径)。 */
const DEFAULT_PAGE_SIZE_OFFSET: [number, number] = [200, 0]

function buildQueryBody(params: InfoQuery): Wire["QueryInfoParams"] {
  return { ...params, page_size_offset: params.page_size_offset ?? DEFAULT_PAGE_SIZE_OFFSET }
}

/** 是否成功定位: 经纬度有限且非 (0,0) 占位 (与 community/model isLocated 同口径)。 */
function isLocated(l: { longitude: number; latitude: number }): boolean {
  return (
    Number.isFinite(l.longitude) &&
    Number.isFinite(l.latitude) &&
    (l.longitude !== 0 || l.latitude !== 0)
  )
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

  async queryInfoEvents(params) {
    return apiFetch<InfoEvent[]>(`${INFO_API_URI}/events`, {
      method: "POST",
      json: buildQueryBody(params),
      cache: "no-store",
      defaultErrorMessage: "获取事件列表失败",
    })
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
    const qs = new URLSearchParams({ url })
    const res = await apiFetch<Info>(`${INFO_API_URI}?${qs}`, {
      cache: "no-store",
      defaultErrorMessage: "获取信息详情失败",
    })
    if (!res.ok) {
      console.error("[getInfo]", res.message)
      return null
    }
    return res.data
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

  async getEntityStats(hours) {
    return apiFetch<EntityStats>(`${INFO_API_URI}/entity/${hours}`, {
      cache: "no-store",
      defaultErrorMessage: "获取热门实体失败",
    })
  },

  async getPublisherLocations() {
    const res = await apiFetch<PublisherLocation[]>(`${INFO_API_URI}/publishers/locations`, {
      cache: "no-store",
      defaultErrorMessage: "获取发布者位置失败",
    })
    if (!res.ok) {
      console.error("[getPublisherLocations]", res.message)
      return []
    }
    return Array.isArray(res.data) ? res.data : []
  },

  async getVisitorLocation() {
    const res = await apiFetch<IpLocation>(`${INFO_API_URI}/geoip`, {
      cache: "no-store",
      defaultErrorMessage: "访问者定位失败",
    })
    if (!res.ok) {
      console.error("[getVisitorLocation]", res.message)
      return null
    }
    const loc = res.data
    return loc && isLocated(loc) ? loc : null
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
    // GET /authorize/secret/{clientId} 返回裸 hex 字符串 (非 JSON), 故用裸 fetch。
    try {
      const r = await fetch(`${AUTH}/secret/${encodeURIComponent(clientId)}`, { cache: "no-store" })
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
}
