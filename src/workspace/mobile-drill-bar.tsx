"use client"

// 移动端下钻返回条 (md:hidden, 挂内容区顶部): 激活标签是节点资源时出现。
// 「一切皆标签页」在移动端没有可见标签条, 从列表/树点开实体后缺少显式返回途径 (系统返回
// 手势不受控) —— 此条补上浏览器式下钻语义: ← 返回 = 关闭当前节点标签, 焦点自动转移到
// 相邻标签 (通常即来处列表); 若关闭后已无标签, 落到该节点所属分区列表 (预览方式, 不堆常驻)。
// 面包屑 = 「分区 / 标题」; 分区名从 HOME_PLACES 单源取。
import { ChevronLeft } from "lucide-react"
import { nodeResourceRefForTab } from "./resource-tab"
import { getTabs, openTarget, requestCloseTab, useActiveId, useTabs } from "./store"
import { homePlaceForNodeKind } from "./tree/home-places"

export default function MobileDrillBar() {
  const tabs = useTabs()
  const activeId = useActiveId()
  const tab = tabs.find((t) => t.id === activeId)
  const ref = nodeResourceRefForTab(tab)
  if (!tab || !ref) return null
  const place = homePlaceForNodeKind(ref.kind)

  function goBack() {
    if (!tab) return
    if (!requestCloseTab(tab.id)) return
    // 关掉的是唯一标签 → 主区留白无处可去, 落到该节点所属分区列表 (预览槽, 不堆常驻)。
    if (getTabs().length === 0) {
      openTarget({
        type: "path",
        path: place?.defaultPath ?? "/home",
        transient: true,
        rootId: "home",
      })
    }
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-card/80 px-1 backdrop-blur md:hidden">
      <button
        type="button"
        onClick={goBack}
        className="flex h-8 shrink-0 items-center gap-0.5 rounded-shell pl-1 pr-2 text-sm text-muted-foreground transition-colors active:bg-accent"
      >
        <ChevronLeft className="h-5 w-5" />
        返回
      </button>
      <span className="min-w-0 flex-1 truncate pr-2 text-sm">
        {place ? <span className="text-muted-foreground">{place.label} / </span> : null}
        <span className="text-foreground">{tab.title}</span>
      </span>
    </div>
  )
}
