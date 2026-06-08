"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatTimestamp } from "@/lib/format"
import { safeHref } from "@/lib/safe-url"
import { getSession, subscribeSession } from "@protocol/auth"
import { deletePublication, getPeerPublications, publish, type Publication } from "@protocol/peer"

/**
 * 「我的发布」: 登录用户发布内容 (供社区订阅) + 管理自己的发布。
 * 自己的发布列表复用公开端点 GET /peer/{id}/publications (id = 当前用户)。
 */
export default function MyPublications() {
  const session = React.useSyncExternalStore(subscribeSession, getSession, () => null)
  const [title, setTitle] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [body, setBody] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [pubs, setPubs] = React.useState<Publication[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const uid = session ? String(session.user.id) : null

  const reload = React.useCallback(async () => {
    if (!uid) return
    const res = await getPeerPublications(uid)
    if (res.ok) {
      setPubs(res.data ?? []) // 空 body → 空列表 (而非 null 卡在"加载中")
      setError(null)
    } else {
      setError(res.message) // 失败置 error, 与"还没发布过"区分
    }
  }, [uid])

  React.useEffect(() => {
    if (!uid) return
    // 延后到下一 tick, 避免在 effect 同步阶段触发 setState
    const t = setTimeout(() => reload(), 0)
    return () => clearTimeout(t)
  }, [uid, reload])

  if (!session) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          登录后即可在社区发布内容，成为社区发布者，被他人订阅。
        </p>
        <Button asChild size="sm">
          <Link href="/auth">登录 / 注册</Link>
        </Button>
      </div>
    )
  }

  async function onPublish(e: React.FormEvent) {
    e.preventDefault()
    if (!session) return
    if (!title.trim()) {
      toast.error("请填写标题")
      return
    }
    setBusy(true)
    try {
      const res = await publish(session.token, {
        title: title.trim(),
        url: url.trim(),
        body: body.trim(),
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      setTitle("")
      setUrl("")
      setBody("")
      toast.success("已发布")
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: number) {
    if (!session) return
    const res = await deletePublication(session.token, id)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    setPubs((prev) => prev?.filter((p) => p.id !== id) ?? null)
    toast.success("已删除")
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">发布</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onPublish} className="flex flex-col gap-2">
            <Input placeholder="标题" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input placeholder="链接 (可选)" value={url} onChange={(e) => setUrl(e.target.value)} />
            <textarea
              placeholder="正文 / 笔记 (可选)"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="min-h-[72px] w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button type="submit" disabled={busy} className="self-start">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              发布
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">我的发布</h2>
        {error ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">加载失败: {error}</p>
            <Button variant="outline" size="sm" onClick={() => reload()}>
              重试
            </Button>
          </div>
        ) : pubs === null ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : pubs.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有发布过内容。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pubs.map((p) => (
              <li
                key={p.id}
                className="flex items-start justify-between gap-2 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  {safeHref(p.url) ? (
                    <a
                      href={safeHref(p.url)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-sm font-medium hover:underline"
                    >
                      {p.title}
                    </a>
                  ) : (
                    <span className="text-sm font-medium">{p.title}</span>
                  )}
                  {p.body ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.body}</p>
                  ) : null}
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {formatTimestamp(p.created_at)}
                  </span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => onDelete(p.id)}
                  title="删除"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">删除</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
