"use client"

// 左侧栏「聚合搜索」(工具): 选引擎 + 输词, 回车在新标签打开对应搜索引擎 (link-out)。
import * as React from "react"
import { Search } from "lucide-react"
import { SEARCH_ENGINES } from "@/modules/tool/engines"
import { jumpToSearchEngine } from "@/lib/search-jump"

const ENGINES = SEARCH_ENGINES.filter((e) => e.queryUrl)

export default function SidebarWebSearch() {
  const [q, setQ] = React.useState("")
  const [engine, setEngine] = React.useState(ENGINES[0].name)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const term = q.trim()
    if (!term) return
    const eng = ENGINES.find((x) => x.name === engine) ?? ENGINES[0]
    if (!eng.queryUrl) return
    jumpToSearchEngine(eng.queryUrl, term)
  }

  return (
    <form
      onSubmit={submit}
      className="mb-2 flex items-center gap-1 rounded-shell border bg-background pl-2 pr-1"
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="聚合搜索…"
        aria-label="聚合搜索关键词"
        className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
      />
      <select
        value={engine}
        onChange={(e) => setEngine(e.target.value)}
        title="选择搜索引擎"
        aria-label="选择搜索引擎"
        className="h-6 shrink-0 rounded bg-transparent text-[11px] text-muted-foreground outline-none"
      >
        {ENGINES.map((x) => (
          <option key={x.name} value={x.name}>
            {x.name}
          </option>
        ))}
      </select>
    </form>
  )
}
