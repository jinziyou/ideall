import type { Metadata, Viewport } from "next"
import "@/app/globals.css"
import { Header } from "./header"
import { Toaster } from "@/components/ui/sonner"
import { THEME_INIT } from "@/components/lib/theme"
import ThemeApplier from "./theme-applier"
import BootGate from "./boot-gate"

export const metadata: Metadata = {
  title: "wonita | 个人信息总控终端",
  description: "本地优先的个人信息总控终端，聚合信息、工具与社区。",
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
        <BootGate>{children}</BootGate>
        <Toaster />
      </body>
    </html>
  )
}
