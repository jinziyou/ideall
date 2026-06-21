import HomeNav from "./home-nav"
import CommandTrigger from "@/app/shell/command-trigger"

export const metadata = {
  title: "我的 | ideall",
  description: "你的信息中枢，订阅、书签、资源只存本机。",
}

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-screen-2xl p-3 sm:p-5">
      <div className="flex flex-col gap-5 md:flex-row">
        {/* A 布局: 上下文栏 (我的子区导航 + 本地存储) */}
        <HomeNav />
        <section className="min-w-0 flex-1">
          {/* 方案 3: 页头纤细命令台触发器 (⌘K 浮层引擎的显式入口) */}
          <div className="mb-4 flex items-center gap-3">
            <CommandTrigger className="h-9 w-full max-w-md" />
          </div>
          {children}
        </section>
      </div>
    </main>
  )
}
