// UI 读取账号会话的薄协议入口；鉴权流程与写操作由 lib/auth 内部编排。
export { getSession, subscribeSession } from "@/lib/auth/auth-store"
