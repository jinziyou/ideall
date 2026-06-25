"use client"

import { Input } from "@/ui/input"
import { Table } from "@tanstack/react-table"
import { Button } from "@/ui/button"
import * as React from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon, Loader2, Search } from "lucide-react"
import { DateRange } from "react-day-picker"
import { cn } from "@/lib/utils"
import { Calendar } from "@/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { toast } from "sonner"
import { fetchLatestInfo, QueryParams } from "../data"
import { Info } from "../model"
import { SubscribeButton } from "@/shared/feeders"
import { entityLabelText } from "@/lib/ner-labels"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** 实体类别下拉的「全部」sentinel (Radix Select 的 value 不允许空串)。 */
const ALL_LABELS = "__all__"
/** 可筛选的实体类别 (TIME 无筛选价值, 与实体展示口径一致地排除)。 */
const ENTITY_LABELS = ["PER", "LOC", "ORG", "PRODUCT", "EVENT"]

export default function InfoToolbar<TData>({
  table,
  onResult,
}: {
  table: Table<TData>
  onResult: (rows: Info[]) => void
}) {
  const [date, setDate] = React.useState<DateRange | undefined>()
  const [domain, setDomain] = React.useState("")
  // 实体过滤: 后端契约 entity_label_name 每项必须带 label, 「全部 + 实体名」无法表达 (不限类别),
  // 故选「全部」时直接禁用实体名输入 —— 实现最简单且不会让用户误以为查了全类别。
  const [entityLabel, setEntityLabel] = React.useState(ALL_LABELS)
  const [entityName, setEntityName] = React.useState("")
  const [querying, setQuerying] = React.useState(false)

  async function handleQuery() {
    const name = entityName.trim()
    // 时间戳用毫秒 (与后端存储一致); 起始端回退一天, 让选中起始日整天落入区间。
    const param: QueryParams = {
      publisher_domain: domain,
      timestamp_from_to: [
        (date?.from?.getTime() ?? 0) - ONE_DAY_MS,
        date?.to?.getTime() ?? Date.now(),
      ],
      entity_label_name: entityLabel !== ALL_LABELS && name ? [[entityLabel, name]] : null,
      page_size_offset: null,
    }
    setQuerying(true)
    try {
      const result = await fetchLatestInfo(param)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      const items = result.data ?? []
      onResult(items)
      toast.success(`查询到 ${items.length} 条记录`)
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
        placeholder="按标题过滤当前结果"
        aria-label="按标题过滤当前结果"
        value={(table.getColumn("title")?.getFilterValue() as string) ?? ""}
        onChange={(event) => table.getColumn("title")?.setFilterValue(event.target.value)}
        className="w-full md:max-w-sm"
      />
      <div className="flex items-center gap-2">
        <label htmlFor="info-filter-domain" className="text-sm text-muted-foreground shrink-0">
          域名:
        </label>
        <Input
          id="info-filter-domain"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          className="w-full md:w-48"
          placeholder="example.com"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground shrink-0">实体:</label>
        <Select value={entityLabel} onValueChange={setEntityLabel}>
          <SelectTrigger className="h-10 w-[104px] shrink-0" aria-label="实体类别">
            <SelectValue placeholder="类别" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_LABELS}>全部</SelectItem>
            {ENTITY_LABELS.map((label) => (
              <SelectItem key={label} value={label}>
                {entityLabelText(label)} {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={entityName}
          onChange={(event) => setEntityName(event.target.value)}
          aria-label="实体名"
          className="w-full md:w-40"
          // 「全部」时禁用: 见上方 entityLabel 状态处注释 (契约要求逐项给 label)
          disabled={entityLabel === ALL_LABELS}
          placeholder={entityLabel === ALL_LABELS ? "先选类别" : "实体名"}
        />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="date" className="text-sm text-muted-foreground shrink-0">
          起止时间:
        </label>
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
                <span>选择起止时间</span>
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
