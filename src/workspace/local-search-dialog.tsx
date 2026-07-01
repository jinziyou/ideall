"use client"

// 顶栏「本地搜索」: 在本机数据 (笔记 / 关注 / 书签 / 资源) 中按标题检索。
// 选中: 笔记/资源/关注 → 打开对应模块标签; 书签 → 直接打开其网址。
// 条目加载/构建复用 local-search-items (与 ⌘K 命令面板同一数据来源)。

import * as React from "react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command"
import {
  loadLocalSearchItems,
  LOCAL_SEARCH_ICON,
  LOCAL_SEARCH_ORDER,
  type LocalSearchItem,
} from "./local-search-items"

export default function LocalSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [items, setItems] = React.useState<LocalSearchItem[]>([])

  React.useEffect(() => {
    if (!open) return
    let alive = true
    loadLocalSearchItems()
      .then((next) => {
        if (alive) setItems(next)
      })
      .catch(() => {
        /* 本地读取失败时静默 */
      })
    return () => {
      alive = false
    }
  }, [open])

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="本地搜索"
      description="搜索本机的笔记 / 关注 / 书签 / 资源"
    >
      <CommandInput placeholder="搜索本地内容…" />
      <CommandList>
        <CommandEmpty>没有匹配的本地内容</CommandEmpty>
        {LOCAL_SEARCH_ORDER.map((g) => {
          const gi = items.filter((i) => i.group === g)
          if (gi.length === 0) return null
          const Icon = LOCAL_SEARCH_ICON[g]
          return (
            <CommandGroup key={g} heading={g}>
              {gi.map((i) => (
                <CommandItem
                  key={i.id}
                  value={i.id}
                  keywords={[i.label]}
                  onSelect={() => {
                    i.run()
                    onOpenChange(false)
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{i.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )
        })}
      </CommandList>
    </CommandDialog>
  )
}
