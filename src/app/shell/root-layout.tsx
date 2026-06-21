import type { Metadata, Viewport } from "next"
import "@/app/globals.css"
import { Header } from "./header"
import Rail from "./rail"
import BottomTabBar from "./bottom-tab-bar"
import CommandPalette from "./command-palette"
import { Toaster } from "@/components/ui/sonner"
import { THEME_INIT } from "@/components/lib/theme"
import ThemeApplier from "./theme-applier"
import BootGate from "./boot-gate"

export const metadata: Metadata = {
  title: "ideall | 个人信息工作台",
  description: "本地优先的个人信息工作台，聚合信息、工具与社区。",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="font-sans antialiased">
        {/* 无闪烁: 首帧前同步打 .dark 类 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {/* 水合后兜底重新断言主题 (防根树重渲染抹掉 .dark) */}
        <ThemeApplier />
        <BootGate>
          {/* A 布局: 桌面左侧图标轨 (Rail) + 内容区; 移动端顶栏 (Header) + 底部标签栏 (BottomTabBar) */}
          <div className="flex min-h-dvh">
            <Rail />
            <div className="flex min-w-0 flex-1 flex-col">
              <Header />
              {/* 移动端底部留出标签栏 + 中央悬浮键高度 */}
              <div className="flex-1 pb-20 md:pb-0">{children}</div>
            </div>
          </div>
          <BottomTabBar />
          {/* ⌘K 浮层命令台: 全局唯一实例 */}
          <CommandPalette />
        </BootGate>
        <Toaster />
      </body>
    </html>
  )
}
