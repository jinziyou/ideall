import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"

// TODO: 全局搜索未接线 —— 计划提交后跳 /info/search 或 /tool/search, 并按本地优先把查询写入
//   localStorage 作为「最近搜索」。暂置 disabled, 避免呈现一个点了没反应的输入框。
export default function MainSearch() {
  return (
    <form className="ml-auto flex-1 sm:flex-initial">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="搜索 (开发中)"
          className="w-full pl-8 sm:w-[260px] lg:w-[320px]"
          disabled
        />
      </div>
    </form>
  )
}
