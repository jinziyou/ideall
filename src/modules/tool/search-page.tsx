import QuickJump from "./quick-jump"
import { SEARCH_ENGINES } from "./engines"

// 工具·搜索视图 (由工作区 registry 作为标签内容渲染; 不再是独立路由页)。
export default function ToolSearchPage() {
  return (
    <QuickJump
      title="搜索"
      placeholder="输入要搜索的关键词…"
      providers={SEARCH_ENGINES}
      historyKey="tool:search:history"
    />
  )
}
