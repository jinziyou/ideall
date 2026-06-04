import type { Metadata, Viewport } from "next"
import "./globals.css"
import { Header } from "./header"
import { Toaster } from "@/components/ui/sonner"

export const metadata: Metadata = {
  title: "wonita | 链接我你TA",
  description: "链接彼此",
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
    <html lang="zh-CN">
      <body className="font-sans antialiased">
        <Header />
        {children}
        <Toaster />
      </body>
    </html>
  )
}
