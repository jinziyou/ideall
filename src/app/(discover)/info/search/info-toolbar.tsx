"use client"

import { Input } from "@/components/ui/input"
import { Table } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import * as React from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon, Loader2, Search } from "lucide-react"
import { DateRange } from "react-day-picker"
import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "sonner"
import { fetchLatestInfo, QueryParams } from "../action"
import { Info } from "../model"
import { SubscribeButton } from "@/app/home/subscribe-button"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export default function InfoToolbar<TData>({
  table,
  onResult,
}: {
  table: Table<TData>
  onResult: (rows: Info[]) => void
}) {
  const [date, setDate] = React.useState<DateRange | undefined>()
  const [domain, setDomain] = React.useState("")
  const [querying, setQuerying] = React.useState(false)

  async function handleQuery() {
    // 时间戳用毫秒 (与 super/server fromepochmillis 一致); 起始端回退一天, 让选中起始日整天落入区间。
    const param: QueryParams = {
      publisher_domain: domain,
      timestamp_from_to: [
        (date?.from?.getTime() ?? 0) - ONE_DAY_MS,
        date?.to?.getTime() ?? Date.now(),
      ],
      entity_label_name: null,
      page_size_offset: null,
    }
    setQuerying(true)
    try {
      const result = await fetchLatestInfo(param)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      onResult(result.data)
      toast.success(`查询到 ${result.data.length} 条记录`)
    } finally {
      setQuerying(false)
    }
  }

  // 「订阅此搜索」: 把当前标题关键词 (+ 可选域名) 存为本地搜索订阅 (本地优先, 订阅流里客户端按标题过滤)
  const titleKeyword = ((table.getColumn("title")?.getFilterValue() as string) ?? "").trim()
  const domainTrim = domain.trim()
  const searchKey = domainTrim ? `${titleKeyword}@${domainTrim}` : titleKeyword
  const searchTitle = domainTrim ? `${titleKeyword} · ${domainTrim}` : titleKeyword

  return (
    <div className="flex flex-col gap-2 py-4 md:flex-row md:flex-wrap md:items-center">
      <Input
        placeholder="过滤当前结果集标题"
        value={(table.getColumn("title")?.getFilterValue() as string) ?? ""}
        onChange={(event) => table.getColumn("title")?.setFilterValue(event.target.value)}
        className="w-full md:max-w-sm"
      />
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground shrink-0">域名:</label>
        <Input
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          className="w-full md:w-48"
          placeholder="example.com"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground shrink-0">起止时间:</label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id="date"
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal md:w-[260px]",
                !date && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
              {date?.from ? (
                date.to ? (
                  <span className="truncate">
                    {format(date.from, "yyyy-MM-dd")} 至 {format(date.to, "yyyy-MM-dd")}
                  </span>
                ) : (
                  <span className="truncate">{format(date.from, "yyyy-MM-dd")}</span>
                )
              ) : (
                <span>选择时间范围</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={date?.from}
              selected={date}
              onSelect={setDate}
              numberOfMonths={1}
              className="sm:hidden"
            />
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={date?.from}
              selected={date}
              onSelect={setDate}
              numberOfMonths={2}
              className="hidden sm:block"
            />
          </PopoverContent>
        </Popover>
      </div>
      <Button onClick={handleQuery} disabled={querying} className="md:ml-auto">
        {querying ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Search className="mr-2 h-4 w-4" />
        )}
        查询
      </Button>
      {titleKeyword && (
        <SubscribeButton
          sub={{
            type: "search",
            key: searchKey,
            title: searchTitle,
            searchKeyword: titleKeyword,
            searchDomain: domainTrim || undefined,
          }}
        />
      )}
    </div>
  )
}
