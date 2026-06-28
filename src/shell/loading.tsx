import { Loader2 } from "lucide-react"

export default function Loading() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      {/* role="status" (含隐式 aria-live=polite): 让读屏播报「正在读取本机数据」加载态 */}
      <div role="status" className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>正在读取本机数据…</span>
      </div>
    </main>
  )
}
