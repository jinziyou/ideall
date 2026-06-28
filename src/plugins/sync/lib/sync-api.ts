// 同步块数据访问 (同构: App 客户端运行期与 pnpm dev SSR 渲染期共用): 直接读写后端 /sync/{id} 的加密密文。
// 仅经手密文, 看不到明文 (端到端加密; 客户端 sync-crypto 已加解密)。

import { SERVER_ADDR } from "@/lib/env"
import { apiFetch, type ApiResult } from "@/lib/api"
import type { SyncBlob } from "@protocol/sync"

/** 取回某 id 的加密同步块; 404 (尚无数据) 归一化为 ok=true, data=null。 */
export async function getSyncBlob(id: string): Promise<ApiResult<SyncBlob | null>> {
  const res = await apiFetch<SyncBlob>(`${SERVER_ADDR}/sync/${encodeURIComponent(id)}`, {
    cache: "no-store",
    defaultErrorMessage: "拉取同步数据失败",
  })
  if (!res.ok && res.status === 404) return { ok: true, data: null }
  return res
}

/**
 * 上传加密同步块。传 `expected` (本端最近读到的 updated_at; 尚无数据传 0) 时走乐观并发:
 * 服务端当前版本与之不符则返回 409 (调用方据此重新 GET→合并→重试)。省略 = 无条件覆盖。
 */
export async function putSyncBlob(
  id: string,
  blob: SyncBlob,
  expected?: number,
): Promise<ApiResult<unknown>> {
  const base = `${SERVER_ADDR}/sync/${encodeURIComponent(id)}`
  const url = expected === undefined ? base : `${base}?expected=${expected}`
  return apiFetch(url, {
    method: "PUT",
    json: blob,
    cache: "no-store",
    defaultErrorMessage: "上传同步数据失败",
  })
}
