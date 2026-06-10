"use server"

// 用户(peer)发布层的 Server Action 中转: 公开发现/读取 + 带 token 的发布/删除。
// 对接 super/server P2a 端点 (/peers, /peer/{id}/publications, /me/publications)。

import { SERVER_ADDR } from "@/components/lib/env"
import { apiFetch, type ApiResult } from "@/components/lib/api"

export type Publication = {
  id: number
  title: string
  url: string
  body: string
  /** epoch 毫秒 */
  created_at: number
}
export type PeerPublisher = { id: number; name: string; publication_count: number }

/** 社区发布者列表 (公开)。 */
export async function getPeers(): Promise<ApiResult<PeerPublisher[]>> {
  return apiFetch<PeerPublisher[]>(`${SERVER_ADDR}/peers`, {
    cache: "no-store",
    defaultErrorMessage: "获取社区发布者失败",
  })
}

/** 某发布者的发布列表 (公开)。 */
export async function getPeerPublications(id: string): Promise<ApiResult<Publication[]>> {
  return apiFetch<Publication[]>(`${SERVER_ADDR}/peer/${encodeURIComponent(id)}/publications`, {
    cache: "no-store",
    defaultErrorMessage: "获取发布失败",
  })
}

/** 发布一条 (需登录 token)。 */
export async function publish(
  token: string,
  input: { title: string; url?: string; body?: string },
): Promise<ApiResult<Publication>> {
  return apiFetch<Publication>(`${SERVER_ADDR}/me/publications`, {
    method: "POST",
    json: { title: input.title, url: input.url ?? "", body: input.body ?? "" },
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    defaultErrorMessage: "发布失败",
  })
}

/** 删除自己的一条发布 (需登录 token)。 */
export async function deletePublication(token: string, id: number): Promise<ApiResult<unknown>> {
  return apiFetch(`${SERVER_ADDR}/me/publications/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    defaultErrorMessage: "删除失败",
  })
}
