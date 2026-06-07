import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function NotFound() {
  return (
    <main className="flex flex-1 items-start justify-center p-4 sm:p-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>404 — 页面未找到</CardTitle>
          <CardDescription>你访问的页面不存在或已被移除。</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end">
          <Button asChild>
            <Link href="/home">返回首页</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
