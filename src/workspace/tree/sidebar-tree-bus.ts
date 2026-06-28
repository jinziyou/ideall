// 侧栏文件树刷新总线 —— 笔记/书签等变更后通知 sidebar-tree 重载 node 子树。

const listeners = new Set<() => void>()

export function subscribeSidebarTreeRefresh(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function refreshSidebarTree(): void {
  for (const l of listeners) l()
}
