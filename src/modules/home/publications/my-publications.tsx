"use client"

import * as React from "react"
import Link from "next/link"
import {
  Bookmark,
  Cloud,
  FileText,
  Loader2,
  Megaphone,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { getSession, subscribeSession } from "@protocol/auth"
import { getPeerPublications, type Publication } from "@protocol/peer"
import { formatTimestamp } from "@/lib/format"
import { safeHref } from "@/lib/safe-url"
import { ConfirmDialog } from "@/shared/prompt-dialog"
import { Badge } from "@/ui/badge"
import { Button } from "@/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/card"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { Textarea } from "@/ui/textarea"
import {
  archivePublishedDraft,
  createPublicationDraft,
  createPublicationDraftFromSource,
  discardPublicationDraft,
  listCommunityMutationGuards,
  listPublicationDrafts,
  listPublicationDraftSources,
  MAX_PUBLICATION_DRAFT_BODY,
  MAX_PUBLICATION_DRAFT_TITLE,
  MAX_PUBLICATION_DRAFT_URL,
  publishCommunityDraft,
  removeCommunityPublication,
  updatePublicationDraft,
  type PublicationDraft,
  type PublicationDraftSource,
} from "./publication-drafts"

type DraftEditor = Readonly<{
  draft: PublicationDraft
  title: string
  url: string
  body: string
}>

function editorForDraft(draft: PublicationDraft): DraftEditor {
  return { draft, title: draft.title, url: draft.url, body: draft.body }
}

function sourceKindLabel(source: Pick<PublicationDraftSource, "kind">): string {
  switch (source.kind) {
    case "note":
      return "笔记"
    case "bookmark":
      return "书签"
    case "browser-capture":
      return "浏览捕获"
  }
}

function sourceIcon(source: Pick<PublicationDraftSource, "kind">) {
  return source.kind === "bookmark" ? Bookmark : FileText
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "操作失败，请稍后重试"
}

function draftChanged(editor: DraftEditor | null): boolean {
  return Boolean(
    editor &&
    (editor.title !== editor.draft.title ||
      editor.url !== editor.draft.url ||
      editor.body !== editor.draft.body),
  )
}

/**
 * 「我的 · 发布」：本地草稿与公开发布之间的隐私闸门。
 *
 * 草稿是普通 Note Node，未登录也能创建、编辑和恢复；只有确认公开发布时才把
 * 标题、链接和正文发送到 ServerPort。本地来源身份与版本永不进入远端请求。
 */
export default function MyPublications() {
  const session = React.useSyncExternalStore(subscribeSession, getSession, () => null)
  const [drafts, setDrafts] = React.useState<PublicationDraft[] | null>(null)
  const [sources, setSources] = React.useState<PublicationDraftSource[] | null>(null)
  const [sourceKey, setSourceKey] = React.useState("")
  const [editor, setEditor] = React.useState<DraftEditor | null>(null)
  const [localBusy, setLocalBusy] = React.useState(false)
  const [publishBusy, setPublishBusy] = React.useState(false)
  const [pendingDiscard, setPendingDiscard] = React.useState<PublicationDraft | null>(null)
  const [pendingPublish, setPendingPublish] = React.useState(false)
  const [unknownDrafts, setUnknownDrafts] = React.useState<ReadonlySet<string>>(new Set())
  const [publishedDrafts, setPublishedDrafts] = React.useState<ReadonlySet<string>>(new Set())
  const [unknownPublications, setUnknownPublications] = React.useState<ReadonlySet<string>>(
    new Set(),
  )
  const [auditRecoveryAvailable, setAuditRecoveryAvailable] = React.useState(true)

  const [pubs, setPubs] = React.useState<Publication[] | null>(null)
  const [remoteError, setRemoteError] = React.useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<Publication | null>(null)

  const uid = session ? String(session.user.id) : null
  const dirty = draftChanged(editor)

  const reloadRemote = React.useCallback(async () => {
    if (!uid) return
    const result = await getPeerPublications(uid)
    if (result.ok) {
      setPubs(result.data ?? [])
      setRemoteError(null)
    } else {
      setRemoteError(result.message)
    }
  }, [uid])

  React.useEffect(() => {
    let active = true
    const timer = setTimeout(async () => {
      try {
        const [nextDrafts, nextSources, pendingMutations] = await Promise.all([
          listPublicationDrafts(),
          listPublicationDraftSources(),
          listCommunityMutationGuards().catch(() => null),
        ])
        if (!active) return
        setDrafts(nextDrafts)
        setSources(nextSources)
        setAuditRecoveryAvailable(pendingMutations !== null)
        setUnknownDrafts(new Set(pendingMutations?.pendingDraftIds ?? []))
        setPublishedDrafts(new Set(pendingMutations?.publishedDraftIds ?? []))
        setUnknownPublications(new Set(pendingMutations?.pendingPublicationIds ?? []))
        setSourceKey((current) =>
          current && nextSources.some((source) => source.key === current)
            ? current
            : (nextSources[0]?.key ?? ""),
        )
        setEditor((current) => {
          if (current) {
            const fresh = nextDrafts.find((draft) => draft.id === current.draft.id)
            if (fresh) return draftChanged(current) ? current : editorForDraft(fresh)
          }
          return nextDrafts[0] ? editorForDraft(nextDrafts[0]) : null
        })
      } catch (error) {
        if (active) toast.error("无法读取本地发布草稿", { description: errorMessage(error) })
      }
    }, 0)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [])

  React.useEffect(() => {
    if (!uid) {
      setPubs(null)
      setRemoteError(null)
      return
    }
    let active = true
    const timer = setTimeout(async () => {
      const result = await getPeerPublications(uid)
      if (!active) return
      if (result.ok) {
        setPubs(result.data ?? [])
        setRemoteError(null)
      } else {
        setRemoteError(result.message)
      }
    }, 0)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [uid])

  function insertDraft(draft: PublicationDraft): void {
    setDrafts((current) => [draft, ...(current ?? []).filter((item) => item.id !== draft.id)])
    setEditor(editorForDraft(draft))
  }

  async function createBlankDraft(): Promise<void> {
    if (dirty && !(await saveCurrentDraft())) return
    setLocalBusy(true)
    try {
      const draft = await createPublicationDraft({ title: "新发布", url: "", body: "" })
      insertDraft(draft)
      toast.success("已创建本地草稿")
    } catch (error) {
      toast.error("创建草稿失败", { description: errorMessage(error) })
    } finally {
      setLocalBusy(false)
    }
  }

  async function createFromSource(): Promise<void> {
    const source = sources?.find((candidate) => candidate.key === sourceKey)
    if (!source) return
    if (dirty && !(await saveCurrentDraft())) return
    setLocalBusy(true)
    try {
      const draft = await createPublicationDraftFromSource(source)
      insertDraft(draft)
      toast.success(`已从${sourceKindLabel(source)}生成本地草稿`)
      if (source.truncated) toast.warning("来源正文较长，草稿已按发布上限截取")
    } catch (error) {
      toast.error("生成草稿失败", { description: errorMessage(error) })
    } finally {
      setLocalBusy(false)
    }
  }

  async function saveCurrentDraft(): Promise<PublicationDraft | null> {
    if (!editor) return null
    setLocalBusy(true)
    try {
      const updated = await updatePublicationDraft(editor.draft, {
        title: editor.title,
        url: editor.url,
        body: editor.body,
      })
      setDrafts((current) =>
        (current ?? []).map((draft) => (draft.id === updated.id ? updated : draft)),
      )
      setEditor(editorForDraft(updated))
      toast.success("草稿已保存")
      return updated
    } catch (error) {
      toast.error("保存草稿失败", { description: errorMessage(error) })
      return null
    } finally {
      setLocalBusy(false)
    }
  }

  async function discardDraft(draft: PublicationDraft): Promise<void> {
    setLocalBusy(true)
    try {
      await discardPublicationDraft(draft)
      const remaining = (drafts ?? []).filter((item) => item.id !== draft.id)
      setDrafts(remaining)
      if (editor?.draft.id === draft.id) {
        setEditor(remaining[0] ? editorForDraft(remaining[0]) : null)
      }
      toast.success("草稿已移入回收站")
    } catch (error) {
      toast.error("丢弃草稿失败", { description: errorMessage(error) })
    } finally {
      setLocalBusy(false)
    }
  }

  async function selectDraft(draft: PublicationDraft): Promise<void> {
    if (editor?.draft.id === draft.id || localBusy || publishBusy) return
    if (dirty && !(await saveCurrentDraft())) return
    setEditor(editorForDraft(draft))
  }

  async function finishPublishedDraftArchive(draft: PublicationDraft): Promise<void> {
    setLocalBusy(true)
    try {
      await archivePublishedDraft(draft, null)
      const remaining = (drafts ?? []).filter((item) => item.id !== draft.id)
      setDrafts(remaining)
      setPublishedDrafts((items) => {
        const next = new Set(items)
        next.delete(draft.id)
        return next
      })
      if (editor?.draft.id === draft.id) {
        setEditor(remaining[0] ? editorForDraft(remaining[0]) : null)
      }
      toast.success("已完成本地归档，不会再次发送到服务器")
    } catch (error) {
      toast.error("本地归档仍未完成", { description: errorMessage(error) })
    } finally {
      setLocalBusy(false)
    }
  }

  async function publishCurrentDraft(): Promise<void> {
    if (!editor || !session) return
    setPublishBusy(true)
    try {
      let current = editor.draft
      if (draftChanged(editor)) {
        const saved = await updatePublicationDraft(editor.draft, {
          title: editor.title,
          url: editor.url,
          body: editor.body,
        })
        current = saved
        setEditor(editorForDraft(saved))
      }
      const outcome = await publishCommunityDraft(session.token, current)
      if (outcome.status === "failed") {
        toast.error("发布失败", { description: outcome.message })
        return
      }
      if (outcome.status === "unknown") {
        setUnknownDrafts((items) => new Set(items).add(current.id))
        toast.error("发布结果待确认", { description: outcome.message })
        await reloadRemote()
        return
      }

      const remaining = (drafts ?? []).filter((draft) => draft.id !== current.id)
      if (outcome.archivePending) {
        setPublishedDrafts((items) => new Set(items).add(current.id))
        setDrafts((items) => [current, ...(items ?? []).filter((draft) => draft.id !== current.id)])
        setEditor(editorForDraft(current))
        toast.success("已公开发布")
        if (outcome.auditPending) toast.warning("发布已成功，但本地审计仍待确认")
        toast.warning("发布已成功；本地草稿待归档，不会再次发送")
        await reloadRemote()
        return
      }
      setDrafts(remaining)
      setEditor(remaining[0] ? editorForDraft(remaining[0]) : null)
      toast.success("已公开发布")
      if (outcome.auditPending) toast.warning("发布已成功，但本地审计仍待确认")
      await reloadRemote()
    } catch (error) {
      toast.error("发布前置检查失败，内容未发送", { description: errorMessage(error) })
    } finally {
      setPublishBusy(false)
    }
  }

  async function deletePublished(publication: Publication): Promise<void> {
    if (!session) return
    setPublishBusy(true)
    try {
      const outcome = await removeCommunityPublication(session.token, publication)
      if (outcome.status === "failed") {
        toast.error("删除失败", { description: outcome.message })
        return
      }
      if (outcome.status === "unknown") {
        setUnknownPublications((items) => new Set(items).add(publication.id))
        toast.error("删除结果待确认", { description: outcome.message })
        await reloadRemote()
        return
      }
      setPubs((current) => current?.filter((item) => item.id !== publication.id) ?? null)
      toast.success("已删除公开内容")
      if (outcome.auditPending) toast.warning("删除已成功，但本地审计仍待确认")
    } catch (error) {
      toast.error("无法建立耐久审计，删除未执行", { description: errorMessage(error) })
    } finally {
      setPublishBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">社区发布草稿</CardTitle>
            <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
              本地优先 · 普通笔记
            </Badge>
          </div>
          <CardDescription>
            从笔记、书签或浏览捕获生成可编辑快照。只有确认发布时才会把表单内容发送到服务器。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Select value={sourceKey} onValueChange={setSourceKey} disabled={!sources?.length}>
              <SelectTrigger aria-label="选择草稿来源">
                <SelectValue
                  placeholder={sources === null ? "正在读取本地内容…" : "没有可用来源"}
                />
              </SelectTrigger>
              <SelectContent>
                {(sources ?? []).map((source) => {
                  const Icon = sourceIcon(source)
                  return (
                    <SelectItem key={source.key} value={source.key}>
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{source.title}</span>
                        <span className="text-muted-foreground">· {sourceKindLabel(source)}</span>
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={() => void createFromSource()}
              disabled={localBusy || !sourceKey}
            >
              {localBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              从来源生成
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void createBlankDraft()}
              disabled={localBusy}
            >
              <Plus className="h-4 w-4" />
              空白草稿
            </Button>
          </div>

          {!auditRecoveryAvailable ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              本地审计状态暂不可读。为避免重复远端操作，公开发布和删除已暂停；本地草稿仍可继续编辑。
            </p>
          ) : null}

          {drafts === null ? (
            <p className="text-sm text-muted-foreground">正在读取本地草稿…</p>
          ) : drafts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
              还没有草稿。你可以从本地内容生成，或新建一个空白草稿。
            </div>
          ) : (
            <div className="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="flex max-h-[480px] flex-col gap-1 overflow-y-auto rounded-lg border p-1">
                {drafts.map((draft) => (
                  <button
                    key={draft.id}
                    type="button"
                    disabled={localBusy || publishBusy}
                    onClick={() => void selectDraft(draft)}
                    className={`rounded-md px-3 py-2 text-left transition-colors ${
                      editor?.draft.id === draft.id ? "bg-accent" : "hover:bg-accent/60"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">{draft.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {draft.origin ? `来自${sourceKindLabel(draft.origin)}` : "空白草稿"} ·{" "}
                      {formatTimestamp(draft.updatedAt)}
                    </span>
                  </button>
                ))}
              </div>

              {editor ? (
                <div className="min-w-0 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="publication-draft-title">标题</Label>
                    <Input
                      id="publication-draft-title"
                      value={editor.title}
                      maxLength={MAX_PUBLICATION_DRAFT_TITLE}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, title: event.target.value } : current,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="publication-draft-url">链接（可选）</Label>
                    <Input
                      id="publication-draft-url"
                      value={editor.url}
                      maxLength={MAX_PUBLICATION_DRAFT_URL}
                      placeholder="https://example.com"
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, url: event.target.value } : current,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="publication-draft-body">正文（可选）</Label>
                      <span className="text-xs text-muted-foreground">
                        {editor.body.length}/{MAX_PUBLICATION_DRAFT_BODY}
                      </span>
                    </div>
                    <Textarea
                      id="publication-draft-body"
                      value={editor.body}
                      maxLength={MAX_PUBLICATION_DRAFT_BODY}
                      rows={8}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, body: event.target.value } : current,
                        )
                      }
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!dirty || localBusy || publishBusy}
                      onClick={() => void saveCurrentDraft()}
                    >
                      {localBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      保存草稿
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={localBusy || publishBusy}
                      onClick={() => setPendingDiscard(editor.draft)}
                    >
                      <Trash2 className="h-4 w-4" />
                      移入回收站
                    </Button>
                    <div className="flex-1" />
                    {publishedDrafts.has(editor.draft.id) ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={localBusy || publishBusy}
                        onClick={() => void finishPublishedDraftArchive(editor.draft)}
                      >
                        {localBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        完成本地归档
                      </Button>
                    ) : session ? (
                      <Button
                        type="button"
                        disabled={
                          publishBusy ||
                          localBusy ||
                          !editor.title.trim() ||
                          !auditRecoveryAvailable ||
                          unknownDrafts.has(editor.draft.id)
                        }
                        onClick={() => setPendingPublish(true)}
                      >
                        {publishBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        {unknownDrafts.has(editor.draft.id) ? "结果待确认" : "公开发布"}
                      </Button>
                    ) : (
                      <Button asChild>
                        <Link href="/auth">登录后发布</Link>
                      </Button>
                    )}
                  </div>

                  <div className="rounded-lg border bg-muted/20 p-4" aria-label="发布预览">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">公开预览</span>
                      <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                        <Cloud className="h-3 w-3" />
                        将经服务器公开
                      </Badge>
                    </div>
                    <h3 className="break-words font-medium">
                      {editor.title.trim() || "未填写标题"}
                    </h3>
                    {safeHref(editor.url.trim()) ? (
                      <a
                        href={safeHref(editor.url.trim())}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 block truncate text-xs text-primary hover:underline"
                      >
                        {editor.url.trim()}
                      </a>
                    ) : editor.url.trim() ? (
                      <p className="mt-1 text-xs text-destructive">链接格式无效</p>
                    ) : null}
                    {editor.body.trim() ? (
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                        {editor.body.trim()}
                      </p>
                    ) : (
                      <p className="mt-3 text-sm text-muted-foreground">没有正文。</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">已公开内容</CardTitle>
            <Badge
              variant="outline"
              className="gap-1 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
            >
              <Cloud className="h-3 w-3" />
              公开 · 经服务器
            </Badge>
          </div>
          <CardDescription>公开内容可被其他社区用户查看和关注。</CardDescription>
        </CardHeader>
        <CardContent>
          {!session ? (
            <div className="flex min-h-32 flex-col items-center justify-center gap-3 py-6 text-center">
              <Megaphone className="h-6 w-6 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">发布身份与本机数据、同步码无关</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  登录后查看和管理自己的公开内容。
                </p>
              </div>
              <Button asChild size="sm">
                <Link href="/auth">登录 / 注册</Link>
              </Button>
            </div>
          ) : remoteError ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-muted-foreground">加载失败：{remoteError}</p>
              <Button variant="outline" size="sm" onClick={() => void reloadRemote()}>
                重试
              </Button>
            </div>
          ) : pubs === null ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : pubs.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有公开发布过内容。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {pubs.map((publication) => (
                <li
                  key={publication.id}
                  className="flex items-start justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    {safeHref(publication.url) ? (
                      <a
                        href={safeHref(publication.url)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="break-words text-sm font-medium hover:underline"
                      >
                        {publication.title}
                      </a>
                    ) : (
                      <span className="break-words text-sm font-medium">{publication.title}</span>
                    )}
                    {publication.body ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {publication.body}
                      </p>
                    ) : null}
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatTimestamp(publication.created_at)}
                    </span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    disabled={
                      publishBusy ||
                      !auditRecoveryAvailable ||
                      unknownPublications.has(publication.id)
                    }
                    onClick={() => setPendingDelete(publication)}
                    title={
                      !auditRecoveryAvailable
                        ? "本地审计状态不可用"
                        : unknownPublications.has(publication.id)
                          ? "删除结果待确认"
                          : "删除"
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">删除</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingDiscard !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDiscard(null)
        }}
        title="把草稿移入回收站？"
        description={
          pendingDiscard
            ? `「${pendingDiscard.title}」只会从草稿列表移除，之后仍可在回收站恢复。`
            : undefined
        }
        confirmLabel="移入回收站"
        onConfirm={() => {
          if (pendingDiscard) void discardDraft(pendingDiscard)
        }}
      />

      <ConfirmDialog
        open={pendingPublish}
        onOpenChange={setPendingPublish}
        title="确认公开发布？"
        description={
          editor
            ? `「${editor.title.trim() || "未填写标题"}」的标题、链接和正文将发送到社区服务器，并对其他用户公开。`
            : undefined
        }
        confirmLabel="确认公开发布"
        onConfirm={() => void publishCurrentDraft()}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="删除这条公开内容？"
        description={
          pendingDelete ? `「${pendingDelete.title}」删除后无法从本地回收站恢复。` : undefined
        }
        confirmLabel="删除"
        destructive
        onConfirm={() => {
          if (pendingDelete) void deletePublished(pendingDelete)
        }}
      />
    </div>
  )
}
