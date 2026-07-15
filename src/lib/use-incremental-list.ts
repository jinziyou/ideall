import * as React from "react"

export interface IncrementalList<T> {
  /** 当前应渲染的切片 (前 count 条)。 */
  visible: T[]
  /** 是否还有未渲染的条目 (用于是否挂 sentinel)。 */
  hasMore: boolean
  /** 挂在列表末尾哨兵元素上的 ref; 进入视口即自动加载下一页。 */
  sentinelRef: React.RefObject<HTMLDivElement | null>
  /** 已渲染条数 (= min(count, total))。 */
  shown: number
  /** 过滤后总条数。 */
  total: number
}

/**
 * 大列表增量渲染 —— 本地优先场景下文件/书签可能累积上千条, 一次性 `.map` 会把全部 DOM
 * (及图片缩略图的 ObjectURL) 一并挂载。此 hook 首屏只渲染 `pageSize` 条, 末尾哨兵进入视口
 * 时 (IntersectionObserver) 再追加一页, 直到全部展开。
 *
 * - `resetKey` 变化 (切换筛选/搜索) → 回到第一页; 在渲染期重置 (React 官方「据 props 调整 state」
 *   模式), 无额外 effect 闪烁。
 * - 数据本身增删 (resetKey 不变) → 保留已展开页数, 不打断当前滚动。
 */
export function useIncrementalList<T>(
  items: T[],
  opts: { enabled?: boolean; pageSize?: number; resetKey?: string } = {},
): IncrementalList<T> {
  const enabled = opts.enabled ?? true
  const pageSize = opts.pageSize ?? 60
  const resetKey = opts.resetKey ?? ""

  const [count, setCount] = React.useState(pageSize)
  const [prevKey, setPrevKey] = React.useState(resetKey)
  if (resetKey !== prevKey) {
    setPrevKey(resetKey)
    setCount(pageSize)
  }

  const total = items.length
  const shown = Math.min(count, total)
  const hasMore = shown < total
  const visible = React.useMemo(() => items.slice(0, count), [items, count])

  const sentinelRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (!enabled || !hasMore) return
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setCount((c) => c + pageSize)
      },
      { rootMargin: "600px" }, // 提前一屏预取, 滚动更顺
    )
    io.observe(el)
    return () => io.disconnect()
  }, [enabled, hasMore, pageSize, total])

  return { visible, hasMore, sentinelRef, shown, total }
}
