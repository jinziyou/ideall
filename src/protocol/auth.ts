// 鉴权契约 —— 账号会话 + X25519 登录方案。
// 数据访问 (同构) / store / crypto 实现物理留在 lib/auth/*; 经此暴露。
export { getServerPublicKey, login, register, fetchMe } from "@/components/lib/auth/auth-api"
export type { AuthBody, AuthPayload, CurrentUser } from "@/components/lib/auth/auth-api"
export {
  getSession,
  subscribeSession,
  setSession,
  clearSession,
} from "@/components/lib/auth/auth-store"
export type { Session } from "@/components/lib/auth/auth-store"
export { newClientId, newKeypair, encryptPassword } from "@/components/lib/auth/crypto"
export type { ClientKeypair } from "@/components/lib/auth/crypto"
