// 文件树 (role=tree) 的方向键导航 —— 跨所有行组件 (TreeRow / NodeTreeBranch / PageTreeRow /
// SubscriptionRow / 工作区行) 共用。DOM 顺序即可视树顺序 (折叠的子项不渲染), 故按 DOM 顺序移动焦点。
// 展开/折叠 (←/→ 命中容器时) 由各行自管 (它知道自己的 onToggle/isOpen); 此处只管「纯焦点移动」。
import type * as React from "react"

function items(fromEl: HTMLElement): { list: HTMLElement[]; idx: number } | null {
  const root = fromEl.closest('[role="tree"]')
  if (!root) return null
  const list = Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'))
  const idx = list.indexOf(fromEl)
  return idx === -1 ? null : { list, idx }
}

/** 把焦点移到相邻 (或首/尾) treeitem; 成功返回 true。 */
export function focusTreeSibling(fromEl: HTMLElement, dir: 1 | -1 | "first" | "last"): boolean {
  const ctx = items(fromEl)
  if (!ctx) return false
  const next =
    dir === "first"
      ? ctx.list[0]
      : dir === "last"
        ? ctx.list[ctx.list.length - 1]
        : ctx.list[ctx.idx + dir]
  if (!next) return false
  next.focus()
  return true
}

/** ↑/↓/Home/End 焦点移动; 命中即 preventDefault。返回是否为这几个键 (调用方据此提前 return)。 */
export function onTreeArrowNav<T extends HTMLElement>(e: React.KeyboardEvent<T>): boolean {
  const dir =
    e.key === "ArrowDown"
      ? 1
      : e.key === "ArrowUp"
        ? -1
        : e.key === "Home"
          ? "first"
          : e.key === "End"
            ? "last"
            : null
  if (dir === null) return false
  focusTreeSibling(e.currentTarget, dir)
  // 这几个键由树消费, 无论焦点是否真的移动 (如已在首/末项) 都吃掉默认滚动。
  e.preventDefault()
  return true
}

/**
 * 树容器 (role=tree) 的 roving 单停靠点: 容器自身 tabIndex=0、全部行 tabIndex=-1 ——
 * 整棵树对 Tab 序只占一个停靠点 (WAI-ARIA APG 树模式), 树内移动交给方向键 (onTreeArrowNav)。
 * Tab 进树聚焦到容器时, 把焦点转发给激活行 (aria-selected) 或首行;
 * 焦点从树内行折返容器 (Shift+Tab) 时不转发, 放行离开。行 tabIndex=-1 不影响鼠标点击聚焦。
 */
export function forwardTreeFocus(e: React.FocusEvent<HTMLElement>) {
  const nav = e.currentTarget
  if (e.target !== nav) return // 行内聚焦冒泡上来的, 不处理
  if (e.relatedTarget instanceof Node && nav.contains(e.relatedTarget)) return // 树内折返 → 放行
  const row =
    nav.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]') ??
    nav.querySelector<HTMLElement>('[role="treeitem"]')
  row?.focus()
}
