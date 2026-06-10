"use server"

// 鉴权中转 (Server Action): 把浏览器算好的密文/请求转发到 super/server /authorize。
// 中转只过密文 (密码在浏览器已 X25519 加密), 看不到明文密码。

import { SERVER_ADDR } from "@/lib/env"
import { apiFetch, type ApiResult } from "@/lib/api"

const AUTH = `${SERVER_ADDR}/authorize`

export type AuthBody = { token: string; token_type: string }
export type AuthPayload = {
  client_id: string
  client_secret: string
  email: string
  encrypted_password: string
}
export type CurrentUser = { id: number; email: string; name: string; avatar: string | null }

/** GET /authorize/secret/{clientId} —— 服务端临时公钥, 返回的是裸 hex 字符串 (非 JSON), 故用裸 fetch。 */
export async function getServerPublicKey(clientId: string): Promise<ApiResult<string>> {
  try {
    const res = await fetch(`${AUTH}/secret/${encodeURIComponent(clientId)}`, { cache: "no-store" })
    const text = (await res.text()).trim()
    if (!res.ok) return { ok: false, status: res.status, message: text || "获取密钥失败，请重试" }
    return { ok: true, data: text }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? `网络错误：${e.message}` : "网络错误" }
  }
}

export async function login(payload: AuthPayload): Promise<ApiResult<AuthBody>> {
  return apiFetch<AuthBody>(`${AUTH}/login`, {
    method: "POST",
    json: payload,
    cache: "no-store",
    defaultErrorMessage: "登录失败",
  })
}

export async function register(payload: AuthPayload): Promise<ApiResult<AuthBody>> {
  return apiFetch<AuthBody>(`${AUTH}/register`, {
    method: "POST",
    json: payload,
    cache: "no-store",
    defaultErrorMessage: "注册失败",
  })
}

/** 带 token 取当前用户 (GET /authorize/authorize)。 */
export async function fetchMe(token: string): Promise<ApiResult<CurrentUser>> {
  return apiFetch<CurrentUser>(`${AUTH}/authorize`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    defaultErrorMessage: "获取用户信息失败",
  })
}
