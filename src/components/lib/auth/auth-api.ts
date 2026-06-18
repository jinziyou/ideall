// 鉴权取数 facade —— 经 `@protocol/server-port` 的 ServerPort (官方实现为 HTTP 适配器)。
// 只经手密文 (密码在浏览器已 X25519 加密), 看不到明文密码。
import { getServerPort, type AuthCredentials } from "@protocol/server-port"

export type { AuthBody, CurrentUser } from "@protocol/server-port"
/** 注册/登录请求体 (= ServerPort 的 AuthCredentials)。 */
export type AuthPayload = AuthCredentials

/** GET /authorize/secret/{clientId} —— 服务端临时公钥 (裸 hex 字符串)。 */
export function getServerPublicKey(clientId: string) {
  return getServerPort().getServerPublicKey(clientId)
}

export function login(payload: AuthPayload) {
  return getServerPort().login(payload)
}

export function register(payload: AuthPayload) {
  return getServerPort().register(payload)
}

/** 带 token 取当前用户 (GET /authorize/authorize)。 */
export function fetchMe(token: string) {
  return getServerPort().getMe(token)
}
