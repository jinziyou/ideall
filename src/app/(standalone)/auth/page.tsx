import AuthForm from "@/shell/auth-form"

export const metadata = {
  title: "登录 | ideall",
}

export default function AuthPage() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center p-4">
      <AuthForm />
    </main>
  )
}
