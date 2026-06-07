// 组合根 (composition root) —— 唯一允许 import 各 app/plugin manifest 的地方。
// 在客户端启动时把它们的能力 (内容解析器 / 后续的 HubDataPort 等) 注册进 protocol registry,
// 使中枢 (core) 永不直接依赖具体 app/plugin。
import { registerContentResolver } from "@protocol/content"
import { registerHubData } from "@protocol/hub-data"
import { hubDataPort } from "@/app/home/lib/hub-data-port"
import { infoManifest } from "@/app/(discover)/info/manifest"
import { communityManifest } from "@/app/(discover)/community/manifest"

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
}
