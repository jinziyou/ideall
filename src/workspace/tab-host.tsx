"use client"

// 标签内容宿主: keep-alive + LRU。重型标签 (fill 查看器 / iframe 嵌入) 全挂载会 OOM
// (Plate 每实例独立 editor 链; iframe 进程不暂停), 故按 LRU 保持后台运行最近若干个、卸载更久未用者。
// 非激活态用 display:none (切标签不重载、iframe 不重新与 MCP 建立连接)。
//
// 逐出安全性 (已 live 验证): 卸载本身是安全的 —— NoteEditor 卸载 cleanup 同步 enqueueNoteDraft,
// 写队列 worker 独立于组件继续落库; 且只逐出**非激活**标签 (激活项恒保持后台运行), 用户无感。
// 故用朴素 LRU (直接卸载 overflow 非激活标签), 不做「逐出前等落库完成」的舞蹈,
// 既简单又避免「每次切标签 overflow 标签反复 mount/flush/unmount」的抖动。
import * as React from "react"
import { cn } from "@/lib/utils"
import { isTauri, browserRelease } from "@/lib/tauri"
import { useTabs, useActiveId, useDirtyTabIds } from "./store"
import { TabContent, tabLayout } from "./registry"
import { TabActiveContext } from "./tab-active-context"
import { tabElId, tabPanelId } from "./tab-view-type"
import type { Tab } from "./types"
import { isBrowserResourceTab, isEmbeddedResourceTab } from "./resource-tab"

const MAX_ALIVE_FILL = 8 // 同时保持后台运行的 fill 查看器 (笔记等) 上限
const MAX_ALIVE_IFRAME = 2 // 同时保持后台运行的嵌入应用 iframe 上限 (重新建立连接代价高, 上限防累积)

/** 重型类别 (参与 LRU 逐出); padded 轻面板永久保持后台运行 → null。 */
function heavyCat(tab: Tab): "fill" | "iframe" | null {
  if (isEmbeddedResourceTab(tab) || tab.kind === "info" || tab.kind === "community") {
    return "iframe"
  }
  return tabLayout(tab) === "fill" ? "fill" : null
}

export default function TabHost() {
  const tabs = useTabs()
  const activeId = useActiveId()
  const dirtyTabIds = useDirtyTabIds()

  // 切离「浏览器」标签 (或无激活标签) 时强制收起原生子 webview —— Linux GTK overlay 否则会挡全窗点击。
  React.useEffect(() => {
    const activeTab = tabs.find((tab) => tab.id === activeId)
    if (activeTab && isBrowserResourceTab(activeTab)) return
    if (isTauri()) void browserRelease().catch(() => {})
  }, [activeId, tabs])

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
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/25 px-6 text-center text-muted-foreground">
        <p className="text-sm font-medium text-foreground">没有打开的标签</p>
        {/* 文案按视口分叉: 移动端没有活动栏/常驻侧栏, 不能指向桌面控件。 */}
        <p className="hidden max-w-xs text-[13px] leading-relaxed md:block">
          从左侧活动栏选择一个模块，再在侧栏中打开文件或面板（单击预览 · 双击固定）。
        </p>
        <p className="max-w-xs text-[13px] leading-relaxed md:hidden">
          点击底部导航选择一个分区，或用顶部菜单浏览文件。
        </p>
      </div>
    )
  }

  // 应挂载集: 每池保持后台运行最近 cap 个 + padded 全挂 + 激活项强制挂。
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const alive = new Set<string>()
  for (const id of dirtyTabIds) alive.add(id)
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
    <div className="h-full w-full bg-muted/25">
      {tabs.map((t) => {
        // LRU 逐出: 卸载内容 (标签条仍在; 未保存草稿已由写队列在卸载时同步入队落库)。
        if (!alive.has(t.id)) return null
        const active = t.id === activeId
        const fill = tabLayout(t) === "fill"
        return (
          <div
            key={t.id}
            role="tabpanel"
            id={tabPanelId(t.id)}
            aria-labelledby={tabElId(t.id)}
            className={cn("h-full w-full", !active && "hidden")}
            aria-hidden={!active}
          >
            <TabActiveContext.Provider value={active}>
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
            </TabActiveContext.Provider>
          </div>
        )
      })}
    </div>
  )
}
