// 同步块数据访问 (同构: App 客户端运行期与 pnpm dev SSR 渲染期共用): 直接读写后端 /v1/sync/{id} 的加密密文。
// 仅经手密文, 看不到明文 (端到端加密; 客户端 sync-crypto 已加解密)。

import { API_V1 } from "@/lib/env"
import { apiFetch, type ApiResult } from "@/lib/api"
import type { SyncBlob } from "@protocol/sync"

/** v1 统一成功响应封装 `{ data, meta? }` (见 wonita infra/response.rs)。 */
type Enveloped<T> = { data: T; meta?: unknown }

/** 取回某 id 的加密同步块; 404 (尚无数据) 规范化为 ok=true, data=null。 */
export async function getSyncBlob(id: string): Promise<ApiResult<SyncBlob | null>> {
  const res = await apiFetch<Enveloped<SyncBlob>>(`${API_V1}/sync/${encodeURIComponent(id)}`, {
    cache: "no-store",
    defaultErrorMessage: "拉取同步数据失败",
  })
  if (!res.ok) return res.status === 404 ? { ok: true, data: null } : res
  return { ok: true, data: res.data ? res.data.data : null }
}

/**
 * 上传加密同步块。`expected` (本端最近读到的 updated_at; 尚无数据传 0) 为必填的乐观并发基线:
 * 服务端当前版本与之不符则返回 409 (调用方据此重新 GET→合并→重试)。
 */
export async function putSyncBlob(
  id: string,
  blob: SyncBlob,
  expected: number,
): Promise<ApiResult<unknown>> {
  const url = `${API_V1}/sync/${encodeURIComponent(id)}?expected=${expected}`
  return apiFetch(url, {
    method: "PUT",
    json: blob,
    cache: "no-store",
    defaultErrorMessage: "上传同步数据失败",
  })
}
