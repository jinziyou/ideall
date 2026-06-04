import AuthForm from "./auth-form"

export const metadata = {
  title: "登录 | wonita",
  description: "登录或注册 —— 用于发布内容、被他人订阅。",
}

export default function AuthPage() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center p-4">
      <AuthForm />
    </main>
  )
}
