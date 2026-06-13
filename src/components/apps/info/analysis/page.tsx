"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { getInfo, getRelatedInfo } from "../action"
import { Info, RelatedInfo } from "../model"
import InfoAnalysisView from "./analysis"
import InfoBasicView from "./basic"

// 全面报道页 (查询参数路由 /info/analysis?url= , 兼容静态导出): 客户端按 url 取单条 + 关联报道。
function AnalysisView() {
  const url = useSearchParams().get("url") ?? ""
  const [info, setInfo] = useState<Info | null>(null)
  const [related, setRelated] = useState<RelatedInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function run() {
      // 在 async 函数内置位 (await 前), 避免 effect 体内同步 setState 的级联渲染 lint。
      setLoading(true)
      if (!url) {
        setInfo(null)
        setLoading(false)
        return
      }
      // 关联报道与单条详情并行拉取。
      const [rel, i] = await Promise.all([getRelatedInfo(url), getInfo(url)])
      if (!active) return
      setRelated(rel)
      setInfo(i)
      setLoading(false)
    }
    run()
    return () => {
      active = false
    }
  }, [url])

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中…
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
