import HomeNav from "./home-nav"

export const metadata = {
  title: "我的 | ideall",
  description: "你的信息中枢，订阅、书签、资源只存本机。",
}

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="m-2 sm:m-4">
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">我的</h1>
          <p className="text-sm text-muted-foreground">
            本机的信息中枢，订阅、收藏、钉住都落在这里。
          </p>
        </div>

        <div className="flex flex-col gap-6 md:flex-row">
          <HomeNav />
          <section className="min-w-0 flex-1">{children}</section>
        </div>
      </div>
    </main>
  )
}
