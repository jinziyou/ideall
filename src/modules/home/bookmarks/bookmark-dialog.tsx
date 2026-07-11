"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Textarea } from "@/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import {
  createBookmarkFile,
  updateBookmarkFile,
  type FileBookmark,
  type FileBookmarkFolder,
} from "./bookmark-file-system"

const NONE_FOLDER = "__none__"

export default function BookmarkDialog({
  open,
  onOpenChange,
  folders,
  editing,
  defaultFolderId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: FileBookmarkFolder[]
  /** 编辑已有书签; 为 null 时是新增 */
  editing: FileBookmark | null
  /** 新增时默认归入的收藏夹 */
  defaultFolderId: string | null
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* 用 key 让表单在每次打开 / 切换编辑目标时重新挂载, 由 useState 初始值同步表单 */}
        {open && (
          <BookmarkForm
            key={editing?.id ?? "new"}
            folders={folders}
            editing={editing}
            defaultFolderId={defaultFolderId}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function BookmarkForm({
  folders,
  editing,
  defaultFolderId,
  onClose,
  onSaved,
}: {
  folders: FileBookmarkFolder[]
  editing: FileBookmark | null
  defaultFolderId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [url, setUrl] = React.useState(editing?.url ?? "")
  const [title, setTitle] = React.useState(editing?.title ?? "")
  const [description, setDescription] = React.useState(editing?.description ?? "")
  const [tags, setTags] = React.useState((editing?.tags ?? []).join(", "))
  const [folderId, setFolderId] = React.useState<string>(
    editing?.folderId ?? defaultFolderId ?? NONE_FOLDER,
  )
  const [saving, setSaving] = React.useState(false)

  async function handleSave() {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      toast.error("请填写链接地址")
      return
    }
    // 自动补全协议
    const normalized = /^[a-z]+:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`
    const tagList = tags
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    const targetFolder = folderId === NONE_FOLDER ? null : folderId
    const folder =
      targetFolder === null ? null : (folders.find((item) => item.id === targetFolder) ?? null)
    if (targetFolder !== null && !folder) {
      toast.error("目标收藏夹不存在")
      return
    }

    setSaving(true)
    try {
      if (editing) {
        await updateBookmarkFile(editing, {
          url: normalized,
          title: title.trim() || normalized,
          description: description.trim(),
          tags: tagList,
          folder,
        })
        toast.success("已更新")
      } else {
        await createBookmarkFile(
          {
            url: normalized,
            title: title.trim() || normalized,
            description: description.trim(),
            tags: tagList,
          },
          folder,
        )
        toast.success("已收藏")
      }
      onSaved()
      onClose()
    } catch (e) {
      toast.error("保存失败", { description: String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "编辑书签" : "新增书签"}</DialogTitle>
        <DialogDescription>
          {editing ? "更新书签的链接、标题、标签与收藏夹。" : "保存一个链接并归档到本地书签库。"}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="bm-url">链接地址</Label>
          <Input
            id="bm-url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bm-title">标题</Label>
          <Input
            id="bm-title"
            placeholder="留空则使用链接地址"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bm-desc">备注</Label>
          <Textarea
            id="bm-desc"
            placeholder="可选"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="bm-tags">标签</Label>
            <Input
              id="bm-tags"
              placeholder="逗号分隔"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>收藏夹</Label>
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_FOLDER}>未分组</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </>
  )
}
