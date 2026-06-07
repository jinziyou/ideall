// 中枢仪表盘/导航的「对话」计数 —— 直接读共享 IndexedDB 的 agentThreads 仓库 (内核读自有基座),
// 不依赖 agent 插件代码 (避免 core → plugin 反向依赖)。
import { idbGetAll, STORE_AGENT_THREADS } from "@/lib/idb"

export async function countAgentThreads(): Promise<number> {
  try {
    const all = await idbGetAll<unknown>(STORE_AGENT_THREADS)
    return all.length
  } catch {
    return 0
  }
}
