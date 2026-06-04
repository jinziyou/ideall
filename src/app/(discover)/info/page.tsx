import Link from "next/link"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import InfoList from "./list"

export default function Info() {
  return (
    <main className="flex min-h-screen flex-col gap-3 p-2 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup type="single" defaultValue="all" className="self-start">
          <ToggleGroupItem value="all" asChild>
            <Link href="/info">全部</Link>
          </ToggleGroupItem>
          {/* TODO: 新闻分类未实现 (/info/news 路由不存在), 暂禁用占位以免点击 404。 */}
          <ToggleGroupItem value="news" disabled>
            新闻
          </ToggleGroupItem>
        </ToggleGroup>
        {/* TODO: 时间段筛选未接线 —— 选中值应转成 timestamp_from_to 传入 fetchInfoEvents, 暂禁用。 */}
        <Select disabled>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="时间段(最近24h)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1h">最近1h</SelectItem>
            <SelectItem value="6h">最近6h</SelectItem>
            <SelectItem value="24h">最近24h</SelectItem>
            <SelectItem value="7d">最近7d</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="w-full">
        <InfoList />
      </div>
    </main>
  )
}
