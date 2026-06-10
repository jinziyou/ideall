// 组合根 (composition root) —— 唯一允许 import 各 app/plugin manifest 的地方。
// 客户端启动时注册进 protocol registry: (1) core 自身实现的 HubDataPort; (2) 各 app/plugin
// manifest 贡献的能力 (info/community 的内容解析器、sync 插件的 SyncPort)。
// 使中枢 (core) 永不直接依赖具体 app/plugin。
import { registerContentResolver } from "@protocol/content"
import { registerHubData } from "@protocol/hub-data"
import { hubDataPort } from "@/app/home/lib/hub-data-port"
import { infoManifest } from "@/components/apps/info/manifest"
import { communityManifest } from "@/components/apps/community/manifest"
import { syncManifest } from "@/components/plugins/sync/manifest"

let booted = false

/** 幂等: 注册所有 app/plugin 能力。客户端启动闸 (BootGate) 调一次。 */
export function registerAll(): void {
  if (booted) return
  booted = true
  // 中枢数据端口 (core 实现, 供 agent 等插件经 protocol 读写中枢数据)。
  registerHubData(hubDataPort)
  for (const m of [infoManifest, communityManifest]) {
    for (const r of m.resolvers ?? []) registerContentResolver(r.types, r.resolve)
  }
  // 插件能力注册 (如 sync 的 SyncPort)。
  for (const p of [syncManifest]) p.register?.()
}
