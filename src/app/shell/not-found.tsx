import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function NotFound() {
  return (
    <main className="flex flex-1 items-start justify-center p-4 sm:p-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>404 · 这里没有东西</CardTitle>
          <CardDescription>这个地址不在你的空间，也不在发现里。</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            或按{" "}
            <kbd className="rounded border bg-muted px-1.5 font-sans text-[10px]">⌘K</kbd>{" "}
            跳转到任意位置
          </p>
          <Button asChild>
            <Link href="/home">回到「我的」</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
