// 同步块数据访问 (同构: web/app 共用): 直接读写 super/server /sync/{id} 的加密密文。
// 仅经手密文, 看不到明文 (端到端加密; 客户端 sync-crypto 已加解密)。

import { SERVER_ADDR } from "@/components/lib/env"
import { apiFetch, type ApiResult } from "@/components/lib/api"
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

/** 覆盖式上传加密同步块。 */
export async function putSyncBlob(id: string, blob: SyncBlob): Promise<ApiResult<unknown>> {
  return apiFetch(`${SERVER_ADDR}/sync/${encodeURIComponent(id)}`, {
    method: "PUT",
    json: blob,
    cache: "no-store",
    defaultErrorMessage: "上传同步数据失败",
  })
}
