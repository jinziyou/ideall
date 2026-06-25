"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/card"
import { encryptPassword, newClientId, newKeypair } from "@protocol/auth"
import { fetchMe, getServerPublicKey, login, register } from "@protocol/auth"
import { setSession } from "@protocol/auth"

/**
 * 登录 / 注册表单。密码在浏览器用 X25519 + XChaCha20-Poly1305 加密后才上送 (复刻 server orion 方案),
 * 上送的只有密文 (浏览器直连后端)。成功后存会话并回「我的」。
 */
export default function AuthForm() {
  const router = useRouter()
  const [mode, setMode] = React.useState<"login" | "register">("login")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      toast.error("请填写邮箱和密码")
      return
    }
    setBusy(true)
    try {
      const clientId = newClientId()
      const { priv, publicHex } = newKeypair()
      const sk = await getServerPublicKey(clientId)
      if (!sk.ok) {
        toast.error(sk.message)
        return
      }
      if (sk.data === null) {
        toast.error("获取密钥失败，请重试")
        return
      }
      const payload = {
        client_id: clientId,
        client_secret: publicHex,
        email: email.trim(),
        encrypted_password: encryptPassword(priv, sk.data, password),
      }
      const res = mode === "login" ? await login(payload) : await register(payload)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      if (!res.data) {
        toast.error(mode === "login" ? "登录失败，请重试" : "注册失败，请重试")
        return
      }
      const me = await fetchMe(res.data.token)
      const user =
        me.ok && me.data
          ? me.data
          : { id: 0, email: email.trim(), name: email.trim(), avatar: null }
      setSession(res.data.token, user)
      toast.success(mode === "login" ? "已登录" : "注册成功，已登录")
      router.push("/home")
    } catch {
      toast.error("操作失败，请重试")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{mode === "login" ? "登录" : "注册"}</CardTitle>
        <CardDescription>
          {mode === "login"
            ? "登录后可在「我的 · 发布」发布内容，供他人订阅。"
            : "注册后可在「我的 · 发布」发布内容，供他人订阅。"}
          密码在浏览器加密后才发送。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input
            type="email"
            placeholder="邮箱"
            aria-label="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <Input
            type="password"
            placeholder="密码"
            aria-label="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="sr-only">提交中…</span>
              </>
            ) : null}
            {mode === "login" ? "登录" : "注册"}
          </Button>
        </form>
        <button
          type="button"
          onClick={() => setMode((m) => (m === "login" ? "register" : "login"))}
          className="mt-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {mode === "login" ? "没有账号? 去注册" : "已有账号? 去登录"}
        </button>
      </CardContent>
    </Card>
  )
}
