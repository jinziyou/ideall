import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function Home() {
  return (
    <main className="flex min-h-screen items-start justify-center p-4 sm:p-8">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>欢迎使用 Wonita</CardTitle>
          <CardDescription>链接彼此 · 想你所想</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:gap-3">
          <Button asChild className="w-full sm:w-auto">
            <Link href="/info">浏览资讯</Link>
          </Button>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/info/search">搜索</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
