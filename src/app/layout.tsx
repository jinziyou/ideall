import type { Metadata, Viewport } from "next"
import "./globals.css"
import { Header } from "./header"
import { Toaster } from "@/components/ui/sonner"
import { THEME_INIT } from "@/lib/theme"
import ThemeApplier from "./theme-applier"

export const metadata: Metadata = {
  title: "wonita | 个人信息总控终端",
  description: "本地优先的个人信息总控终端，从个人视角聚合并掌控信息、资源、工具与社区。",
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
        <Header />
        {children}
        <Toaster />
      </body>
    </html>
  )
}
