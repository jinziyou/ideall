import AuthForm from "@core/shell/auth-form"

export const metadata = {
  title: "登录 | wonita",
  description: "登录或注册账号 —— 用于在「我的发布」发布内容、成为可被订阅的社区发布者。",
}

export default function AuthPage() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center p-4">
      <AuthForm />
    </main>
  )
}
