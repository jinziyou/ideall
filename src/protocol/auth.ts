// 鉴权契约 —— 账号会话 + X25519 登录方案。
// Server Action / store / crypto 实现物理留在 lib/auth/*; 经此暴露。
export { getServerPublicKey, login, register, fetchMe } from "@/lib/auth/auth-action"
export type { AuthBody, AuthPayload, CurrentUser } from "@/lib/auth/auth-action"
export { getSession, subscribeSession, setSession, clearSession } from "@/lib/auth/auth-store"
export type { Session } from "@/lib/auth/auth-store"
export { newClientId, newKeypair, encryptPassword } from "@/lib/auth/crypto"
export type { ClientKeypair } from "@/lib/auth/crypto"
