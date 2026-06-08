import HomeNav from "./home-nav"

export const metadata = {
  title: "我的空间 | wonita",
  description: "你的信息中枢 —— 订阅、资源与书签汇于一处，本地恒在。",
}

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="m-2 sm:m-4">
      <div className="flex flex-col gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">我的空间</h1>
          <p className="text-sm text-muted-foreground">
            信息中枢 · 订阅、资源与书签 —— 个人数据 (订阅偏好 / 资源 / 书签) 本地 · 此设备 ——
            存在本机浏览器、不上传服务器。
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
