// 中枢仪表盘/导航的「对话」计数 —— 直接读共享 IndexedDB 的 agentThreads 仓库 (内核读自有基座),
// 不依赖 agent 插件代码 (避免 core → plugin 反向依赖)。
import { idbCount, STORE_AGENT_THREADS } from "@/components/lib/idb"

export async function countAgentThreads(): Promise<number> {
  try {
    // count() 不反序列化线程文档 (消息内联其中, 整库可达数 MB), 只回条数。
    return await idbCount(STORE_AGENT_THREADS)
  } catch {
    return 0
  }
}
