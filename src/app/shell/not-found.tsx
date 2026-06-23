import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import CommandTrigger from "@/components/shared/command-trigger"

export default function NotFound() {
  return (
    <main className="flex flex-1 items-start justify-center p-4 sm:p-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>404 · 这里没有东西</CardTitle>
          <CardDescription>这个地址不在「我的」，也不在「发现」里。</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          {/* 可点击的命令台入口 (触屏也能用; ⌘K 仅在桌面尺寸显示) */}
          <CommandTrigger className="min-w-0 flex-1" />
          <Button asChild>
            <Link href="/home">回到「我的」</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
