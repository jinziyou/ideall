"use server"

// 同步块中转 (Server Action): 仅把客户端加密好的密文转发到 super/server /sync/{id}。
// 中转只经手密文, 看不到明文 (端到端加密)。

import { APISERVER_ADDR } from "@/lib/env"
import { apiFetch, type ApiResult } from "@/lib/api"

export type SyncBlob = { iv: string; ciphertext: string; updated_at: number }

/** 取回某 id 的加密同步块; 404 (尚无数据) 归一化为 ok=true, data=null。 */
export async function getSyncBlob(id: string): Promise<ApiResult<SyncBlob | null>> {
  const res = await apiFetch<SyncBlob>(`${APISERVER_ADDR}/sync/${encodeURIComponent(id)}`, {
    cache: "no-store",
    defaultErrorMessage: "拉取同步数据失败",
  })
  if (!res.ok && res.status === 404) return { ok: true, data: null }
  return res
}

/** 覆盖式上传加密同步块。 */
export async function putSyncBlob(id: string, blob: SyncBlob): Promise<ApiResult<unknown>> {
  return apiFetch(`${APISERVER_ADDR}/sync/${encodeURIComponent(id)}`, {
    method: "PUT",
    json: blob,
    cache: "no-store",
    defaultErrorMessage: "上传同步数据失败",
  })
}
