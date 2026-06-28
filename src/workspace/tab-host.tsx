"use client"

// 标签内容宿主: keep-alive + LRU。重型标签 (fill 查看器 / iframe 嵌入) 全挂载会 OOM
// (Plate 每实例独立 editor 链; iframe 进程不暂停), 故按 LRU 保活最近若干个、卸载更久未用者。
// 非激活态用 display:none (切标签不重载、iframe 不重新握手 MCP)。
//
// 逐出安全性 (对设计稿 §5.3 的简化, 已 live 验证): 设计稿用 evicting-as-state + 逐出前 flushNode
// 的「保活到落库完成」舞蹈, 那是为修已废弃的 flushRef+await 方案。但 P1a 写队列已让卸载本身安全 ——
// NoteEditor 卸载 cleanup 同步 enqueueNoteDraft, worker 独立于组件继续落库; 且只逐出**非激活**标签
// (激活项恒保活), 用户无感。故此处用朴素 LRU (直接卸载 overflow 非激活标签), 无 evicting 舞蹈,
// 既简单又避免「每次切标签 overflow 标签反复 mount/flush/unmount」的抖动。
import * as React from "react"
import { cn } from "@/lib/utils"
import { isTauri, browserHide } from "@/lib/tauri"
import { useTabs, useActiveId, useActiveTabKind } from "./store"
import { TabContent, tabLayout } from "./registry"
import type { Tab } from "./types"

const MAX_ALIVE_FILL = 8 // 同时保活的 fill 查看器 (笔记等) 上限
const MAX_ALIVE_IFRAME = 2 // 同时保活的嵌入应用 iframe 上限 (重新握手代价高, 上限防累积)

/** 重型类别 (参与 LRU 逐出); padded 轻面板永久保活 → null。 */
function heavyCat(tab: Tab): "fill" | "iframe" | null {
  if (tab.kind === "info" || tab.kind === "community") return "iframe"
  return tabLayout(tab) === "fill" ? "fill" : null
}

export default function TabHost() {
  const tabs = useTabs()
  const activeId = useActiveId()
  const activeKind = useActiveTabKind()

  // 切离「浏览器」标签时强制收起原生子 webview (Linux overlay 否则会挡 iframe 点击)。
  React.useEffect(() => {
    if (activeKind === "browser-view" || activeKind === null) return
    if (isTauri()) void browserHide().catch(() => {})
  }, [activeKind])

  // LRU 顺序: 最近激活在末尾。openTab 即激活, 故每个曾打开的标签都进过此表。
  // 用 React 官方「渲染期按 key 调整派生态」模式维护 (非 effect): 当 activeId / 标签集变化时
  // 在 render 期重排一次, React 会以新态重渲染后再提交, 避免 set-state-in-effect 的级联渲染。
  const [lru, setLru] = React.useState<string[]>([])
  const [syncKey, setSyncKey] = React.useState("")
  const curKey = (activeId ?? "") + "|" + tabs.map((t) => t.id).join(",")
  if (curKey !== syncKey) {
    setSyncKey(curKey)
    setLru((prev) => {
      const ids = new Set(tabs.map((t) => t.id))
      let next = prev.filter((id) => ids.has(id)) // 清掉已关闭的标签
      if (activeId && ids.has(activeId)) {
        next = next.filter((id) => id !== activeId)
        next.push(activeId) // 激活项移到末尾 (最近)
      }
      return next
    })
  }

  if (tabs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center text-muted-foreground">
        <p className="text-sm font-medium text-foreground">没有打开的标签</p>
        <p className="max-w-xs text-xs leading-relaxed">
          从左侧活动栏选择一个模块，再从侧栏打开一个面板。
        </p>
      </div>
    )
  }

  // 应挂载集: 每池保活最近 cap 个 + padded 全挂 + 激活项强制挂。
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const alive = new Set<string>()
  const keepRecent = (cat: "fill" | "iframe", cap: number) => {
    const ids = lru.filter((id) => {
      const t = byId.get(id)
      return t && heavyCat(t) === cat
    })
    for (const id of ids.slice(-cap)) alive.add(id)
  }
  keepRecent("fill", MAX_ALIVE_FILL)
  keepRecent("iframe", MAX_ALIVE_IFRAME)
  for (const t of tabs) if (heavyCat(t) === null) alive.add(t.id) // padded 全挂
  if (activeId) alive.add(activeId) // 激活项恒挂

  return (
    <div className="h-full w-full bg-background">
      {tabs.map((t) => {
        // LRU 逐出: 卸载内容 (标签条仍在; 未保存草稿已由写队列在卸载时同步入队落库)。
        if (!alive.has(t.id)) return null
        const active = t.id === activeId
        const fill = tabLayout(t) === "fill"
        return (
          <div
            key={t.id}
            className={cn("h-full w-full", !active && "hidden")}
            aria-hidden={!active}
          >
            {fill ? (
              // 桌面: 组件自管理内部滚动 (h-full); 移动: 允许整体滚动兜底 (笔记等无视口高度约束)。
              <div className="h-full w-full overflow-y-auto md:overflow-hidden">
                <TabContent tab={t} />
              </div>
            ) : (
              <div className="h-full w-full overflow-y-auto">
                <div className="mx-auto w-full max-w-screen-2xl p-4 sm:p-6">
                  <TabContent tab={t} />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
