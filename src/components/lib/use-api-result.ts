"use client"

import * as React from "react"
import { toast } from "sonner"
import type { ApiResult } from "@/components/lib/api"

/**
 * 客户端按需取数的统一 hook —— 收敛 (discover)/info 各页几乎逐字相同的
 * `useState data/loading + useEffect{ active 守卫 + !ok→toast.error + setData + finally setLoading(false) }` 样板。
 *
 * 行为:
 *   - 卸载 / 依赖变化时用 `active` 守卫丢弃过期响应;
 *   - `result.ok === false` 时 `setError(message)` + `toast.error`, 不改动 data (保留上次/初始值);
 *   - 成功时 `setData(result.data ?? initial)` (200/204 空 body data 为 null, 退化为 initial
 *     避免消费方崩) + 清除 error;
 *   - 无论成败 `finally` 都 `setLoading(false)`;
 *   - `reload()` 强制重取 (供失败时"重试"); 调用即 setLoading(true)。
 *
 * 返回 `error` 让页面区分"加载失败"(error 非空) 与"真无数据"(error 为空但 data 空)。
 *
 * @param fetcher 返回 `ApiResult<T>` 的取数函数 (同构数据访问函数, 如 info/action 的 fetchLatestInfo)。
 * @param initial data 初始值 (与原各页保持一致, 如 `[]`)。
 * @param deps 触发重新取数的依赖项 (传 `[]` 即仅首次挂载取数)。
 * @param opts.silent 失败时仍 setError 但不 toast —— 供增强型区块 (如热门实体榜) 使用:
 *   它们失败时整体隐藏, 弹 toast 会让用户看到错误却找不到出错的 UI, 还与主链路报错叠成双 toast。
 */
export function useApiResult<T>(
  fetcher: () => Promise<ApiResult<T>>,
  initial: T,
  deps: unknown[],
  opts?: { silent?: boolean },
): { data: T; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = React.useState<T>(initial)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [nonce, setNonce] = React.useState(0)

  const reload = React.useCallback(() => setNonce((n) => n + 1), [])

  React.useEffect(() => {
    let active = true
    async function run() {
      // 在 async 函数内 (await 前) 置位, 避免 effect 体内同步 setState 触发级联渲染 lint;
      // 既覆盖首次挂载 (loading 初值已为 true), 也覆盖 reload/deps 变化时重新进入加载态。
      setLoading(true)
      setError(null)
      try {
        const result = await fetcher()
        if (!active) return
        if (!result.ok) {
          setError(result.message)
          if (!opts?.silent) toast.error(result.message)
        } else {
          setData(result.data ?? initial)
          setError(null)
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    run()
    return () => {
      active = false
    }
    // fetcher 由调用方按 deps 重建; nonce 用于 reload 强制重取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, loading, error, reload }
}
