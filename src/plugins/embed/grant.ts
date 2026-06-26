// L3 会话/授权层 —— Grant 模型 (本地数据提供方设计 §4, 见 docs/local-data-provider.md)。
//
// 现状反向取数只有 iframe「一方信任」一条路径, 授权是隐式的 (静态 manifest + 自动放行)。
// 本模块把它显式化为 Grant: 「哪个消费方 / 在哪个源 / 被授了哪些权 / 何时授 / 是否可撤 / 何时过期」。
// 这是 P1 (最稳/最高杠杆) 的一半 —— 即便暂不加新 transport / consent UI, 也把一方信任显式化,
// 为未来 native-messaging / loopback transport 与「已连接的应用」consent 面板铺路。能力层 (createLocalMcpServer)
// 据 Grant 起 server, 与 transport 解耦。
//
// 注: 本文件是纯逻辑 (无 UI / 无 IO), now 注入便于测试; 持久化的 Grant 存储 (T1+/IndexedDB) 是 P2 的事, 此处不做。
import type { Manifest } from "./manifest"
import type { Permission } from "./protocol"

/** 信任层级 (设计 §4): T0 一方自动 / T1 已验消费方一次性同意 / T2 任意源逐源显式配对。 */
export type GrantTier = "first-party" | "verified" | "any-origin"

/**
 * 一次授权 —— 消费方在能力边界上「能做什么」的显式记录。
 * 能力层只注册 `permissions` 内的 tool/resource (越权 = 工具不存在)。
 */
export interface Grant {
  /** 消费方 id (一方取 manifest.id; T1+ 配对时分配)。 */
  consumerId: string
  /** 消费方源 (iframe origin / 扩展 id / web origin) —— 对端认证锚点。 */
  origin: string
  /** 信任层级。 */
  tier: GrantTier
  /** 授权位 (宿主据此注册 tool/resource)。 */
  permissions: Permission[]
  /** 授予时间 epoch 毫秒。 */
  grantedAt: number
  /** 过期时间 epoch 毫秒; null = 不过期 (一方)。 */
  expiry: number | null
  /** 是否可吊销 (一方为惯例不可撤; T1+ 可在「已连接的应用」面板撤销)。 */
  revocable: boolean
}

/**
 * 由一方 (first-party) manifest 构造 T0 Grant —— 自动、不过期、不可撤, 保留现状语义。
 * iframe 路径 (host.tsx) 用; 一方 manifest 是 ideall 自带的, 故权限直接采信。
 */
export function firstPartyGrant(manifest: Manifest, now: number): Grant {
  let origin = ""
  try {
    origin = new URL(manifest.entry).origin
  } catch {
    origin = manifest.origins[0] ?? ""
  }
  return {
    consumerId: manifest.id,
    origin,
    tier: "first-party",
    permissions: manifest.permissions,
    grantedAt: now,
    expiry: null,
    revocable: false,
  }
}

/**
 * Grant 当前是否有效 (未过期; expiry=null 恒有效)。吊销由上层删除 Grant 体现, 不在此判定。
 * 能力层 (createLocalMcpServer) 据此决定: 失效 → 起零工具的空 server (失效消费方无任何能力)。
 */
export function isGrantActive(grant: Grant, now: number): boolean {
  return grant.expiry == null || now < grant.expiry
}

// ── 信任档偏序门 (设计 docs/extension-registry-design.md §2.1) ────────────────────
/** 信任档偏序: 数值越大越可信。 */
export const TIER_RANK: Record<GrantTier, number> = {
  "first-party": 2,
  verified: 1,
  "any-origin": 0,
}

/** a 档是否 ≥ b 档。 */
export function tierAtLeast(a: GrantTier, b: GrantTier): boolean {
  return TIER_RANK[a] >= TIER_RANK[b]
}

/**
 * 敏感授权位要求的最低信任档: 主权写 / 私密读 / 以用户身份发布 钉死 first-party。
 * 未列出的位 = any-origin (不额外抬门槛, 仅靠 permissions 成员判定)。
 * 现状所有 Grant 均 first-party, 故此门当前不改变行为; 是 verified/any-origin 接入前的前置闸。
 */
export const PERMISSION_MIN_TIER: Partial<Record<Permission, GrantTier>> = {
  "fs:write": "first-party",
  "fs.notes:read": "first-party",
  "fs.notes:write": "first-party",
  "fs.blobs:read": "first-party",
  "identity.publish": "first-party",
  // 出站联网钉死 first-party: 未来 verified/any-origin 嵌入页即便携此位也被 effectivePermissions 剥掉,
  // 不能借宿主拿到任意外网 egress (嵌入页自有同源取数, 不该走宿主出站通道)。
  "web:search": "first-party",
  "web:fetch": "first-party",
}

/**
 * Grant 在其信任档下「实际可用」的授权位: 滤掉信任档不达标的敏感位。
 * 能力层 (createLocalMcpServer) 据此注册 —— 低信任档消费方即便 permissions 里携带敏感位,
 * 对应能力也不挂载 (越权 = 工具不存在)。
 */
export function effectivePermissions(grant: Grant): Permission[] {
  return grant.permissions.filter((p) =>
    tierAtLeast(grant.tier, PERMISSION_MIN_TIER[p] ?? "any-origin"),
  )
}

/**
 * 本应用 agent 的默认授权集 (§6.2): fs 读写 + 笔记写 + 标签面 + 出站联网。
 * **故意不含 fs.notes:read / fs.blobs:read** —— agent 默认看不到既存笔记正文与上传文件二进制 (只看标题/文件名概览);
 * 正文须 @ 引用单条 consent 注入, 文件二进制须用户单独授权 fs.blobs:read。
 * 也不含 identity.publish / hub.* (统一走 fs.* 文件面)。
 * 含 web:search / web:fetch —— agent 可联网搜索并抓取网页正文返回 (返回数据, 非只 link-out)。安全靠 @/lib/web-search
 * 的 egress 守卫 (https-only + 私网/元数据 IP 拦截 + 重定向逐跳复检 + 体积/超时/去凭证), 而非 consent 闸;
 * 抓取内容由 agent 系统提示标注「数据非指令」防间接提示注入 (见 agent-context.ts)。
 */
const AGENT_PERMISSIONS: Permission[] = [
  "fs:read",
  "fs:write",
  "fs.notes:write",
  "ui.tabs",
  "web:search",
  "web:fetch",
]

/**
 * 本应用 agent 的 Grant —— 不复用 firstPartyGrant (无 manifest), 经 LoopbackTransport 消费同一能力层。
 * 一方信任、不过期、不可撤 (本应用自带的 AI)。
 */
export function agentGrant(now: number): Grant {
  return {
    consumerId: "ideall-agent",
    origin: "loopback",
    tier: "first-party",
    permissions: [...AGENT_PERMISSIONS],
    grantedAt: now,
    expiry: null,
    revocable: false,
  }
}
