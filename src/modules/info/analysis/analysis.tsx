"use client"

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card"
import { Info, RelatedInfo } from "../model"
import CoverageList from "./coverage"

// 知识图谱仅在 TabsContent 展开时才加载, 首屏不计入图谱 (AntV G6) 体积
const KnowledgeGraph = dynamic(() => import("./graph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[400px] items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      加载图谱…
    </div>
  ),
})

/**
 * 全面报道视图: `analysis` 是后端 (经 ServerPort) 算出的「描述同一件事」的其它来源。
 * 默认直接呈现来源列表 (把原本孤立的信息关联起来), 关系图谱按需切换。
 */
export default function InfoAnalysisView({
  info,
  analysis,
}: {
  info: Info
  analysis: RelatedInfo[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          全面报道
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            {analysis.length} 个相关来源
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">描述同一事件的其他来源报道</p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="list" className="w-full">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="list" className="flex-1 sm:flex-none">
              来源列表
            </TabsTrigger>
            <TabsTrigger value="graph" className="flex-1 sm:flex-none">
              关系图谱
            </TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="mt-3">
            <CoverageList items={analysis} />
          </TabsContent>
          <TabsContent value="graph" className="mt-3">
            <KnowledgeGraph info={info} related={analysis} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
