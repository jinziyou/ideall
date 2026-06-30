"use client"

import * as React from "react"
import Link from "next/link"
import { Cloud, Loader2, Megaphone, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/ui/badge"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/card"
import { formatTimestamp } from "@/lib/format"
import { safeHref } from "@/lib/safe-url"
import { ConfirmDialog } from "@/shared/prompt-dialog"
import { getSession, subscribeSession } from "@protocol/auth"
import { deletePublication, getPeerPublications, publish, type Publication } from "@protocol/peer"

/**
 * 「我的 · 发布」: 登录用户发布内容 (供社区关注) + 管理自己的发布。
 * 自己的发布列表复用公开端点 GET /v1/peers/{id}/publications (id = 当前用户)。
 */
export default function MyPublications() {
  const session = React.useSyncExternalStore(subscribeSession, getSession, () => null)
  const [title, setTitle] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [body, setBody] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [pubs, setPubs] = React.useState<Publication[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  // 发布是公开且不可撤销的远端动作, 删除前确认 (区别于本地书签/笔记的可撤销删除)
  const [pendingDelete, setPendingDelete] = React.useState<Publication | null>(null)

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
    let active = true
    // 延后到下一 tick, 避免在 effect 同步阶段触发 setState
    const t = setTimeout(async () => {
      const res = await getPeerPublications(uid)
      if (!active) return // uid 在请求期间变更: 丢弃过期结果, 防旧账号列表落到新状态
      if (res.ok) {
        setPubs(res.data ?? [])
        setError(null)
      } else {
        setError(res.message)
      }
    }, 0)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [uid])

  if (!session) {
    return (
      <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Megaphone className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">发布要用账号身份，与本机数据、同步码无关</p>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            登录后发布内容，供他人关注。
          </p>
        </div>
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
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">发布</CardTitle>
            <Badge
              variant="outline"
              className="gap-1 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
            >
              <Cloud className="h-3 w-3" />
              公开 · 经服务器
            </Badge>
          </div>
          <CardDescription>发布是公开的，任何人都能关注。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onPublish} className="flex flex-col gap-2">
            <Input
              placeholder="标题"
              aria-label="发布标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              placeholder="链接 (可选)"
              aria-label="发布链接 (可选)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <textarea
              placeholder="正文 / 笔记 (可选)"
              aria-label="发布正文 / 笔记 (可选)"
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
        <h2 className="text-sm font-medium text-muted-foreground">已发布内容</h2>
        {error ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">加载失败：{error}</p>
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
                      className="break-words text-sm font-medium hover:underline"
                    >
                      {p.title}
                    </a>
                  ) : (
                    <span className="break-words text-sm font-medium">{p.title}</span>
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
                  onClick={() => setPendingDelete(p)}
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

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null)
        }}
        title="删除这条发布？"
        description={
          pendingDelete ? `「${pendingDelete.title}」是公开发布，删除后不可恢复。` : undefined
        }
        confirmLabel="删除"
        destructive
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id)
        }}
      />
    </div>
  )
}
