// ServerPort 契约 —— ideall 用自己的领域词汇定义「一个信息服务必须提供什么」。
//
// 这是本地优先 / 混合 P2P 定位的关键端口: ideall = ordinary peer, 不被任何单一后端绑死。
// 任何实现了 `ServerPort` 的节点 (官方 wonita 服务、第三方、未来嵌入式/局域网 peer)
// 都能服务 ideall。HTTP → wonita 服务只是「其中一个适配器」(见 components/lib/server/http-adapter)。
//
// 与 FilesPort / SyncPort / ContentPort 一脉相承 (端口 + register/get), 但有一点不同:
// ServerPort 是**同构**的 (SSR 预渲染期也要取数 —— `pnpm dev` 与导出前预渲染, 此时客户端启动闸 BootGate 尚未运行),
// 故 `getServerPort()` 默认回退到官方 HTTP 适配器; App 形态 / 测试 / 未来其它节点可经
// `registerServerPort()` 覆盖。领域类型在此自有定义, **不依赖** wonita 服务的 wire DTO
// (openapi 生成的 `lib/api/server.d.ts`); wire→domain 的映射与漂移门收敛在 HTTP 适配器内。
import type { ApiResult } from "@/lib/api"
import { httpServerAdapter } from "@/lib/server/http-adapter"

// ── 领域类型 (ideall 自有; 与 wonita 服务 wire DTO 在适配器内做编译期漂移门校验) ──────────────

/** 命名实体 (NER 结果)。`label`: PER/ORG/LOC/TIME/PRODUCT/EVENT; `period` 为所属周 (周一 0 点) epoch 毫秒。 */
export interface NameEntity {
  label: string
  name: string
  /** 所属周 (周一 0 点) epoch 毫秒 */
  period: number
  /** 词条富化: 是否有百科词条 (缺省兼容旧数据) */
  has_entry?: boolean
  baike_url?: string | null
  wikipedia_url?: string | null
}

/** 发布者 (信息来源)。 */
export interface Publisher {
  domain: string
  name: string
  /** epoch 毫秒 */
  period: number
}

/** 一条信息。时间戳全为 epoch 毫秒 (collect_time/publish_time)。 */
export interface Info {
  url: string
  title: string
  data: string
  language: string
  labels: NameEntity[]
  publisher: Publisher
  /** 采集时间 epoch 毫秒 */
  collect_time: number
  /** 发布时间 epoch 毫秒 */
  publish_time: number
}

/** `/info/analysis` 响应项: Info 平铺 + 关联强度分数 (向后兼容按 Info 读)。 */
export type RelatedInfo = Info & {
  /** 与目标共享的实体数 (全实体口径) */
  shared: number
  /** 与目标共享且两侧都有百科词条的实体数 (更可信) */
  shared_entry: number
}

/** 实体摘要 (实体搜索结果项 / 详情共现实体项)。 */
export interface EntityBrief {
  label: string
  name: string
  /** 提及/共现的信息条数 */
  count: number
  has_entry: boolean
}

/** 实体的单周提及量 (`period` = 周一零点 epoch 毫秒)。 */
export interface EntityPeriodCount {
  count: number
  /** epoch 毫秒 */
  period: number
}

/** 实体详情聚合 (`GET /info/entity?label=&name=`)。实体不存在时 `mention_count = 0`。 */
export interface EntityDetail {
  label: string
  name: string
  mention_count: number
  /** 最早/最晚提及的采集时间 epoch 毫秒 (无提及时为 0) */
  first_seen: number
  last_seen: number
  has_entry: boolean
  baike_url?: string | null
  wikipedia_url?: string | null
  /** 共现实体 top N (按共同出现的信息条数倒序) */
  co_entities: EntityBrief[]
  /** 按周 period 的提及分布 (升序) */
  weekly: EntityPeriodCount[]
}

/** 信息查询参数。分页 `[page_size, page_index]`; 时间区间 `[from, to]` epoch 毫秒闭区间。 */
export interface InfoQuery {
  /** 实体筛选, 每项为 `(label, name)` */
  entity_label_name?: [string, string][] | null
  /** 限定发布者域名 */
  publisher_domain?: string | null
  /** `[from, to]` epoch 毫秒闭区间 */
  timestamp_from_to?: [number, number] | null
  /** 分页 `(page_size, page_index)` */
  page_size_offset?: [number, number] | null
}

/** 社区发布者 (用户) 公开档案 + 发布数。`id` 即关注键 (`type:"peer"` 的 key)。 */
export interface PeerPublisher {
  /** 用户节点 id (= JWT claims.id) */
  id: number
  name: string
  publication_count: number
}

/** 一条发布内容。 */
export interface Publication {
  id: number
  title: string
  /** 关联链接 (可空) */
  url: string
  /** 正文/笔记 (可空) */
  body: string
  /** 发布时间 epoch 毫秒 */
  created_at: number
}

/** 发布入参 (POST /me/publications)。 */
export interface PublishDraft {
  title: string
  url?: string
  body?: string
}

/** 登录会话凭证 (服务端签发的 token)。 */
export interface AuthBody {
  token: string
  token_type: string
}

/** 注册/登录请求体。密码经 X25519 共享密钥 AEAD 加密后以 hex 传输 (浏览器侧加密, 服务端见不到明文)。 */
export interface AuthCredentials {
  /** 用户(浏览器)指纹, 用作 SessionID */
  client_id: string
  /** 客户端 X25519 公钥 (hex) */
  client_secret: string
  email: string
  /** 加密后的密码 (hex): 前 24 字节 nonce, 末 16 字节 Poly1305 标签, 中间密文 */
  encrypted_password: string
}

/** 当前登录用户 (公开发布身份)。 */
export interface CurrentUser {
  id: number
  email: string
  name: string
  avatar: string | null
}

// ── 端口 ────────────────────────────────────────────────────────────────────────

/**
 * ServerPort 契约 —— ideall 期望「一个信息服务」提供的全部操作 (以 ideall 领域词汇表达)。
 *
 * 返回约定沿用既有数据层口径以零成本对接 UI:
 *   - 列表/分页等可重试的取数返回 `ApiResult<T>` (调用方按 `ok` 分支 + toast);
 *   - 增强类取数 (拿不到不阻塞主链路) 直接返回 `T | null` / `T[]` 并自行降级。
 *   - `getInfo` 例外: 它支撑「全面报道」整页主链路, 失败必须可与「真不存在」区分 (否则断网被误导成
 *     「信息已移除」且无重试), 故归入 `ApiResult` 类 —— `ok:false` 为取数失败, `ok:true & data:null` 为真不存在。
 */
export interface ServerPort {
  // 信息查询
  queryInfo(params: InfoQuery): Promise<ApiResult<Info[]>>
  getRelatedInfo(url: string): Promise<RelatedInfo[]>
  getInfo(url: string): Promise<ApiResult<Info>>
  getEntityDetail(label: string, name: string): Promise<EntityDetail | null>
  // 社区发布层
  listPeers(): Promise<ApiResult<PeerPublisher[]>>
  getPeerPublications(id: string): Promise<ApiResult<Publication[]>>
  publish(token: string, draft: PublishDraft): Promise<ApiResult<Publication>>
  deletePublication(token: string, id: number): Promise<ApiResult<unknown>>
  // 鉴权 (X25519 登录方案)
  getServerPublicKey(clientId: string): Promise<ApiResult<string>>
  login(payload: AuthCredentials): Promise<ApiResult<AuthBody>>
  register(payload: AuthCredentials): Promise<ApiResult<AuthBody>>
  getMe(token: string): Promise<ApiResult<CurrentUser>>
  /** 更新发布资料 (PUT /me/profile)。嵌入桥 `me.updateProfile` 用; token 由宿主持有, 不出 iframe。 */
  updateProfile(
    token: string,
    patch: { name?: string; avatar?: string },
  ): Promise<ApiResult<unknown>>
}

let override: ServerPort | null = null

/**
 * 覆盖默认的 wonita 服务适配器。
 * App 形态 (嵌入式/局域网节点)、测试、或对接非官方 ServerPort 实现时调用; 默认无需注册 (见下)。
 * 传 `null` 清除覆盖、回退默认 (测试复位用)。
 */
export function registerServerPort(p: ServerPort | null): void {
  override = p
}

/**
 * 取 ServerPort 端口。默认回退到官方 HTTP 适配器 (对接 wonita 服务),
 * 故 SSR 预渲染期 (BootGate 未运行) 也可用; `registerServerPort()` 可覆盖。
 */
export function getServerPort(): ServerPort {
  return override ?? httpServerAdapter
}
