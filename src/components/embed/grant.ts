// L3 会话/授权层 —— Grant 模型 (本地数据提供方设计 §4, 见 docs/local-data-provider.md)。
//
// 现状反向取数只有 iframe「一方信任」一条路径, 授权是隐式的 (静态 manifest + 自动放行)。
// 本模块把它显式化为 Grant: 「哪个消费方 / 在哪个源 / 被授了哪些权 / 何时授 / 是否可撤 / 何时过期」。
// 这是 P1 (最稳/最高杠杆) 的一半 —— 即便暂不加新 transport / consent UI, 也把一方信任显式化,
// 为未来 native-messaging / loopback transport 与「已连接的应用」consent 面板铺路。能力层 (createHubMcpServer)
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
 * 能力层 (createHubMcpServer) 据此决定: 失效 → 起零工具的空 server (失效消费方无任何能力)。
 */
export function isGrantActive(grant: Grant, now: number): boolean {
  return grant.expiry == null || now < grant.expiry
}
