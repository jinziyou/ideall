"use client"

// 顶栏中部「本地搜索」入口 (点击打开本地搜索对话框)。
import * as React from "react"
import { Search } from "lucide-react"
import LocalSearchDialog from "./local-search-dialog"

export default function TopSearch() {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-7 w-full max-w-md items-center gap-2 rounded-shell border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">搜索本地内容…</span>
      </button>
      <LocalSearchDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
