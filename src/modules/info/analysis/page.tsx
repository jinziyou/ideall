"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/ui/button"
import { getInfo, getRelatedInfo } from "../data"
import { Info, RelatedInfo } from "../model"
import InfoAnalysisView from "./analysis"
import InfoBasicView from "./basic"

// 全面报道页 (查询参数路由 /info/analysis?url= , 兼容静态导出): 客户端按 url 取单条 + 关联报道。
function AnalysisView() {
  const url = useSearchParams().get("url") ?? ""
  const [info, setInfo] = useState<Info | null>(null)
  const [related, setRelated] = useState<RelatedInfo[]>([])
  const [loading, setLoading] = useState(true)
  // 取数失败 (区别于「真不存在」): 非空即显示「加载失败 + 重试」, 不再把断网/故障误导成「信息已移除」。
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let active = true
    async function run() {
      // 在 async 函数内置位 (await 前), 避免 effect 体内同步 setState 的级联渲染 lint。
      setLoading(true)
      setError(null)
      if (!url) {
        setInfo(null)
        setLoading(false)
        return
      }
      // 关联报道 (best-effort 降级) 与单条详情 (ApiResult) 并行拉取。
      const [rel, res] = await Promise.all([getRelatedInfo(url), getInfo(url)])
      if (!active) return
      setRelated(rel)
      if (!res.ok) {
        setError(res.message)
        setInfo(null)
      } else {
        setInfo(res.data)
      }
      setLoading(false)
    }
    run()
    return () => {
      active = false
    }
  }, [url, nonce])

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中…
      </main>
    )
  }
  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
        <p>加载失败：{error}</p>
        <Button variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          重试
        </Button>
      </main>
    )
  }
  if (!info) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {url ? "信息不存在或已移除" : "缺少信息地址"}
      </main>
    )
  }

  return (
    <main className="grid min-h-screen w-full gap-4 p-3 sm:p-4 md:grid-cols-5">
      <section className="md:col-span-2">
        <InfoBasicView info={info} />
      </section>
      <section className="md:col-span-3">
        <InfoAnalysisView info={info} analysis={related} />
      </section>
    </main>
  )
}

export default function InfoAnalysisPage() {
  return (
    <Suspense>
      <AnalysisView />
    </Suspense>
  )
}
