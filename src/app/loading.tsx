import { Loader2 } from "lucide-react"

export default function Loading() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>加载中…</span>
      </div>
    </main>
  )
}
