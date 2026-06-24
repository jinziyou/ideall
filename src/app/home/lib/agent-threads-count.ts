// 中枢仪表盘/导航的「对话」计数 —— 折叠步 D 后线程已是 nodes 仓库的 kind:"thread" 节点 (core 拥有),
// 经 core threads-store 计数 (core→core, 不依赖 agent 插件代码)。
import { countThreads } from "./threads-store"

export async function countAgentThreads(): Promise<number> {
  try {
    return await countThreads()
  } catch {
    return 0
  }
}
