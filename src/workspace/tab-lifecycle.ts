import type { Tab, TabDescriptor } from "./types"
import { tabKey } from "./tab-key"

export const MAX_PERMANENT_TABS = 12

export type TransientTabOpenPatch = Readonly<{
  tabs: Tab[]
  transientId: string | null
  activeId: string
}>

/** 纯策略：复用唯一预览槽；命中既有标签时只激活，不改变其常驻状态。 */
export function planTransientTabOpen(
  tabs: Tab[],
  transientId: string | null,
  descriptor: TabDescriptor,
): TransientTabOpenPatch {
  const id = tabKey(descriptor)
  if (tabs.some((tab) => tab.id === id)) {
    return { tabs, transientId, activeId: id }
  }
  if (transientId && tabs.some((tab) => tab.id === transientId)) {
    return {
      tabs: tabs.map((tab) => (tab.id === transientId ? { ...descriptor, id } : tab)),
      transientId: id,
      activeId: id,
    }
  }
  return { tabs: [...tabs, { ...descriptor, id }], transientId: id, activeId: id }
}

export type ColdTabEvictionInput = Readonly<{
  tabs: Tab[]
  transientId: string | null
  lru: readonly string[]
  dirtyIds: ReadonlySet<string>
  protectedIds: ReadonlySet<string>
  maxPermanentTabs?: number
}>

/** 纯策略：按旧→新的 LRU 顺序回收冷常驻标签，预览、dirty 与 protected 标签不参与。 */
export function evictColdTabs({
  tabs,
  transientId,
  lru,
  dirtyIds,
  protectedIds,
  maxPermanentTabs = MAX_PERMANENT_TABS,
}: ColdTabEvictionInput): Tab[] {
  const permanentCount = tabs.reduce(
    (count, tab) => (tab.id === transientId ? count : count + 1),
    0,
  )
  const overflow = permanentCount - maxPermanentTabs
  if (overflow <= 0) return tabs
  const rank = new Map(lru.map((id, index) => [id, index]))
  const evictable = tabs
    .filter((tab) => tab.id !== transientId && !protectedIds.has(tab.id) && !dirtyIds.has(tab.id))
    .sort((left, right) => (rank.get(left.id) ?? -1) - (rank.get(right.id) ?? -1))
    .slice(0, overflow)
  if (evictable.length === 0) return tabs
  const drop = new Set(evictable.map((tab) => tab.id))
  return tabs.filter((tab) => !drop.has(tab.id))
}

export type TabClosePlan = Readonly<{
  closingTab: Tab
  tabs: Tab[]
  activeId: string | null
  activeChanged: boolean
  nextActiveTab: Tab | null
  transientId: string | null
}>

/** 纯策略：关闭活动项时优先选择原位置右侧，再选择左侧。 */
export function planTabClose(
  tabs: readonly Tab[],
  activeId: string | null,
  transientId: string | null,
  id: string,
): TabClosePlan | null {
  const index = tabs.findIndex((tab) => tab.id === id)
  if (index === -1) return null
  const closingTab = tabs[index]
  if (!closingTab) return null
  const remaining = tabs.filter((tab) => tab.id !== id)
  const activeChanged = activeId === id
  const nextActiveTab = activeChanged
    ? (remaining[index] ?? remaining[index - 1] ?? null)
    : (remaining.find((tab) => tab.id === activeId) ?? null)
  return {
    closingTab,
    tabs: remaining,
    activeId: activeChanged ? (nextActiveTab?.id ?? null) : activeId,
    activeChanged,
    nextActiveTab,
    transientId: transientId === id ? null : transientId,
  }
}

export type DirtyTabClosePolicy = Readonly<{
  ids: string[]
  title: string
  description: string
  confirmLabel: string
}>

/** 纯策略：筛出候选中的 dirty 标签并生成稳定确认文案。 */
export function dirtyTabClosePolicy(
  tabs: readonly Tab[],
  dirtyIds: ReadonlySet<string>,
  candidateIds: readonly string[],
): DirtyTabClosePolicy | null {
  const ids = candidateIds.filter((id) => dirtyIds.has(id))
  if (ids.length === 0) return null
  const selected = new Set(ids)
  const dirtyTabs = tabs.filter((tab) => selected.has(tab.id))
  const names = dirtyTabs
    .slice(0, 3)
    .map((tab) => `「${tab.title || "未命名"}」`)
    .join("、")
  const extra = dirtyTabs.length > 3 ? `等 ${dirtyTabs.length} 个标签` : ""
  return {
    ids,
    title: "关闭未保存的标签？",
    description: `${names}${extra} 有未保存更改，关闭后会丢失这些更改。`,
    confirmLabel: "关闭标签",
  }
}
