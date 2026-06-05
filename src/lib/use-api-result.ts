"use client"

import * as React from "react"
import { toast } from "sonner"
import type { ApiResult } from "@/lib/api"

/**
 * 客户端按需取数的统一 hook —— 收敛 (discover)/info 各页几乎逐字相同的
 * `useState data/loading + useEffect{ active 守卫 + !ok→toast.error + setData + finally setLoading(false) }` 样板。
 *
 * 行为与原各页一致:
 *   - 卸载 / 依赖变化时用 `active` 守卫丢弃过期响应;
 *   - `result.ok === false` 时 `toast.error(result.message)`, 不改动 data (保留上次/初始值);
 *   - 成功时 `setData(result.data)`;
 *   - 无论成败 `finally` 都 `setLoading(false)`。
 *
 * @param fetcher 返回 `ApiResult<T>` 的取数函数 (通常是 Server Action)。
 * @param initial data 初始值 (与原各页保持一致, 如 `[]`)。
 * @param deps 触发重新取数的依赖项 (传 `[]` 即仅首次挂载取数)。
 */
export function useApiResult<T>(
  fetcher: () => Promise<ApiResult<T>>,
  initial: T,
  deps: unknown[],
): { data: T; loading: boolean } {
  const [data, setData] = React.useState<T>(initial)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true
    async function run() {
      try {
        const result = await fetcher()
        if (!active) return
        if (!result.ok) {
          toast.error(result.message)
        } else {
          setData(result.data)
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    run()
    return () => {
      active = false
    }
    // fetcher 由调用方按 deps 重建; 依赖项透传, 与原各页一致。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading }
}
