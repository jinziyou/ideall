"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/card"
import { setSession } from "@/lib/auth/auth-store"
import { useFlowProgress } from "@/lib/use-flow-progress"

/**
 * 登录 / 注册表单。密码在浏览器用 X25519 + XChaCha20-Poly1305 加密后才上传 (复刻 server orion 方案),
 * 编排经 auth-flow-machine (XState); 成功后 setSession 并回「我的」。
 */
export default function AuthForm() {
  const router = useRouter()
  const [mode, setMode] = React.useState<"login" | "register">("login")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const progress = useFlowProgress()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const { runAuthFlow } = await import("@/lib/auth/auth-flow-machine")
      const { token, user } = await runAuthFlow({ mode, email, password })
      await setSession(token, user)
      toast.success(mode === "login" ? "已登录" : "注册成功，已登录")
      router.push("/home")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败，请重试")
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
            ? "登录后可在「我的 · 发布」发布内容，供他人关注。"
            : "注册后可在「我的 · 发布」发布内容，供他人关注。"}
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
          {busy && progress?.kind === "auth" ? (
            <p className="text-center text-xs text-muted-foreground" aria-live="polite">
              {progress.label}
            </p>
          ) : null}
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
