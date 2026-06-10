"use client"

import * as React from "react"
import { Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SubscribeButton } from "@/components/feeders"
import { getPeers, type PeerPublisher } from "@protocol/peer"

/**
 * 社区发布者 (用户) 列表 —— community 的核心: 浏览发布过内容的用户并就地订阅 (type:"peer")。
 * 与 info 的权威组织发布者不同, 这里是平台用户作为发布者。
 */
export default function PeerPublishers() {
  const [peers, setPeers] = React.useState<PeerPublisher[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [nonce, setNonce] = React.useState(0)

  // 重试在事件处理器里 reset (非 effect, 不触发同步 setState lint), 再 bump nonce 重取。
  const reload = () => {
    setPeers(null)
    setError(null)
    setNonce((n) => n + 1)
  }

  React.useEffect(() => {
    let alive = true
    getPeers()
      .then((r) => {
        if (!alive) return
        if (r.ok) {
          setPeers(r.data ?? [])
          setError(null)
        } else {
          // 失败置 error (而非空数组), 与"真的没有发布者"区分开
          setError(r.message)
        }
      })
      .catch(() => {
        if (alive) setError("网络错误")
      })
    return () => {
      alive = false
    }
  }, [nonce])

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
        <span>加载失败：{error}</span>
        <Button variant="outline" size="sm" onClick={reload}>
          重试
        </Button>
      </div>
    )
  }
  if (peers === null) {
    return <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
  }
  if (peers.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        还没有社区发布者。登录后在「我的空间 · 我的发布」发布内容。
      </p>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {peers.map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-lg border p-2.5">
          <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{p.name}</div>
            <div className="text-xs text-muted-foreground">{p.publication_count} 条发布</div>
          </div>
          <SubscribeButton sub={{ type: "peer", key: String(p.id), title: p.name }} />
        </div>
      ))}
    </div>
  )
}
