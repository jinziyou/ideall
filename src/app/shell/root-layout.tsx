import type { Metadata, Viewport } from "next"
import "@/app/globals.css"
import WorkspaceShell from "@/app/workspace/workspace-shell"
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
          {/* Trae 风格标签工作区壳: 活动栏 + 二级侧栏 + 多标签主区 + 状态栏 (移动端降级为顶栏+底栏)。
              各路由页是无 UI 的「开标签」标记, 内容由壳内持久挂载的 TabHost 渲染 (keep-alive)。 */}
          <WorkspaceShell>{children}</WorkspaceShell>
          {/* ⌘K 浮层命令台: 全局唯一实例 */}
          <CommandPalette />
        </BootGate>
        <Toaster />
      </body>
    </html>
  )
}
