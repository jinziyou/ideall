"use client"

import { useEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

// 路由段错误边界 (渲染在 layout 之内)。如需替换根 layout 的全局兜底, 应另建 app/global-error.tsx。
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[app-error]", error)
  }, [error])

  return (
    <main className="flex flex-1 items-start justify-center p-4 sm:p-8">
      <Card className="w-full max-w-lg">
        <CardHeader className="flex flex-row items-start gap-3">
          <AlertTriangle className="h-6 w-6 shrink-0 text-destructive" />
          <div className="space-y-1.5">
            <CardTitle>页面加载出错</CardTitle>
            <CardDescription>请稍后重试，若问题持续存在，可返回首页重新进入。</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border bg-muted/40 p-3 text-xs break-all text-muted-foreground">
            {error.message || "未知错误"}
            {error.digest ? <div className="mt-1 opacity-70">digest: {error.digest}</div> : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => window.location.assign("/")}>
              返回首页
            </Button>
            <Button onClick={() => reset()}>重试</Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
