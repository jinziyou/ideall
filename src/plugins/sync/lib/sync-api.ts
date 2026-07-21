// V2 账号绑定的分区同步数据访问。服务端只保存 AES-GCM 密文：客户端先上传
// 不可变 generation parts，全部成功后再 CAS 提交 manifest，读取方因此永远只看到完整快照。

import { API_V2_APP } from "@/lib/env"
import { apiFetch, type ApiResult } from "@/lib/api"
import { getSession } from "@/lib/auth/auth-store"
import { SYNC_MAX_RESPONSE_BYTES, type SyncGenerationPart, type SyncManifest } from "@protocol/sync"

type V2Envelope<T> = { data: T; meta?: unknown }
type SyncPartWrite = { iv: string; ciphertext: string }

function authHeaders(): Record<string, string> {
  const token = getSession()?.token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function unwrap<T>(result: ApiResult<V2Envelope<T>>): ApiResult<T> {
  if (!result.ok) return result
  if (!result.data) return { ok: false, message: "服务端返回了无效的 V2 同步响应" }
  return { ok: true, data: result.data.data }
}

function manifestUrl(id: string): string {
  return `${API_V2_APP}/sync/${encodeURIComponent(id)}/manifest`
}

function generationUrl(id: string, generation: string): string {
  return `${API_V2_APP}/sync/${encodeURIComponent(id)}/generations/${encodeURIComponent(generation)}`
}

function partUrl(id: string, generation: string, partIndex: number): string {
  return `${generationUrl(id, generation)}/parts/${partIndex}`
}

/** 读当前已原子提交的 manifest；404 = 尚无 V2 分区快照。 */
export async function getSyncManifest(id: string): Promise<ApiResult<SyncManifest | null>> {
  const result = await apiFetch<V2Envelope<SyncManifest>>(manifestUrl(id), {
    headers: authHeaders(),
    cache: "no-store",
    defaultErrorMessage: "拉取同步清单失败",
    maxResponseBytes: 32_768,
  })
  if (!result.ok) return result.status === 404 ? { ok: true, data: null } : result
  return unwrap(result)
}

/** 只能读取 manifest 当前指向的 generation part。 */
export function getSyncGenerationPart(
  id: string,
  generation: string,
  partIndex: number,
): Promise<ApiResult<SyncGenerationPart>> {
  return apiFetch<V2Envelope<SyncGenerationPart>>(partUrl(id, generation, partIndex), {
    headers: authHeaders(),
    cache: "no-store",
    defaultErrorMessage: `拉取同步分片 ${partIndex + 1} 失败`,
    maxResponseBytes: SYNC_MAX_RESPONSE_BYTES,
  }).then(unwrap)
}

/** 上传一个不可变分片；同 generation/index 同内容重试幂等成功。 */
export function putSyncGenerationPart(
  id: string,
  generation: string,
  partIndex: number,
  part: SyncPartWrite,
): Promise<ApiResult<unknown>> {
  return apiFetch(partUrl(id, generation, partIndex), {
    method: "PUT",
    json: part,
    headers: authHeaders(),
    cache: "no-store",
    defaultErrorMessage: `上传同步分片 ${partIndex + 1} 失败`,
  })
}

/** 所有 parts 完成后 CAS 切换可见快照。 */
export function commitSyncManifest(
  id: string,
  generation: string,
  partCount: number,
  expected: number,
): Promise<ApiResult<SyncManifest>> {
  return apiFetch<V2Envelope<SyncManifest>>(`${manifestUrl(id)}?expected=${expected}`, {
    method: "PUT",
    json: { generation, part_count: partCount },
    headers: authHeaders(),
    cache: "no-store",
    defaultErrorMessage: "提交同步清单失败",
  }).then(unwrap)
}

/** 最善努力清理未提交 generation，防止中断上传长期占用配额。 */
export async function discardSyncGeneration(
  id: string,
  generation: string,
): Promise<ApiResult<unknown>> {
  const result = await apiFetch(generationUrl(id, generation), {
    method: "DELETE",
    headers: authHeaders(),
    cache: "no-store",
    defaultErrorMessage: "清理未提交同步分片失败",
  })
  return !result.ok && result.status === 404 ? { ok: true, data: null } : result
}
