// 登录/注册流程纯步骤 —— X25519 握手 → 提交 → 拉 profile; 由 auth-flow-machine (XState) 编排。
import type { AuthPayload, CurrentUser } from "@/lib/auth/auth-api"
import { fetchMe, getServerPublicKey, login, register } from "@/lib/auth/auth-api"
import { encryptPassword, newClientId, newKeypair } from "@/lib/auth/crypto"

export type AuthFlowInput = {
  mode: "login" | "register"
  email: string
  password: string
}

export type AuthFlowResult = {
  token: string
  user: CurrentUser
}

export type AuthHandshakeResult = {
  payload: AuthPayload
  email: string
}

/** 校验输入、生成客户端密钥对、拉服务端临时公钥并加密密码。 */
export async function runAuthHandshake(input: AuthFlowInput): Promise<AuthHandshakeResult> {
  const email = input.email.trim()
  if (!email || !input.password) throw new Error("请填写邮箱和密码")

  const clientId = newClientId()
  const { priv, publicHex } = newKeypair()
  const sk = await getServerPublicKey(clientId)
  if (!sk.ok) throw new Error(sk.message)
  if (sk.data === null) throw new Error("获取密钥失败，请重试")

  const payload: AuthPayload = {
    client_id: clientId,
    client_secret: publicHex,
    email,
    encrypted_password: encryptPassword(priv, sk.data, input.password),
  }
  return { payload, email }
}

/** 登录或注册; 成功返回 token 与邮箱 (供 profile 降级)。 */
export async function runAuthSubmit(
  mode: AuthFlowInput["mode"],
  payload: AuthPayload,
): Promise<{ token: string; email: string }> {
  const res = mode === "login" ? await login(payload) : await register(payload)
  if (!res.ok) throw new Error(res.message)
  if (!res.data) {
    throw new Error(mode === "login" ? "登录失败，请重试" : "注册失败，请重试")
  }
  return { token: res.data.token, email: payload.email }
}

/** 拉当前用户; 失败时回退为最小 CurrentUser (与原 auth-form 行为一致)。 */
export async function runAuthProfile(token: string, email: string): Promise<AuthFlowResult> {
  const me = await fetchMe(token)
  const user =
    me.ok && me.data ? me.data : { id: 0, email, name: email, avatar: null as string | null }
  return { token, user }
}
