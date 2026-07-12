"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { AlertTriangle, Loader2, RotateCcw, Save } from "lucide-react"
import { toast } from "sonner"
import { fileRefKey, type IdeallFile } from "@protocol/file-system"
import { readFile, writeFile } from "@/filesystem/registry"
import { base64ToBytes } from "@/lib/base64"
import { TEXT_PREVIEW_LIMIT, textPreviewRange } from "@/lib/file-preview"
import { formatBytes } from "@/lib/format"
import { Button } from "@/ui/button"
import {
  acceptExternalTextDraft,
  createTextDraftDocument,
  editTextDraft,
  isTextDraftDocument,
  markTextDraftSaved,
  reconcileTextDraft,
} from "../file-engine-data"
import { fileEngineTab } from "../file-tab"
import { promoteTab, setTabDirty, setTabSuspendReady, tabKey } from "../store"
import { useTabActive } from "../tab-active-context"
import {
  clearEngineSuspendSnapshot,
  readEngineSuspendSnapshot,
  writeEngineSuspendSnapshot,
} from "../engine-suspension"

const CodeEditor = dynamic(() => import("@/shared/code-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      正在加载编辑器…
    </div>
  ),
})

function textFromData(data: unknown): Promise<string> | string {
  if (typeof data === "string") return data
  if (data instanceof Blob) return data.text()
  if (data && typeof data === "object" && "base64" in data && typeof data.base64 === "string") {
    return new TextDecoder().decode(base64ToBytes(data.base64))
  }
  return JSON.stringify(data, null, 2)
}

export default function GenericCodeEngine({
  file,
  engineId,
  readOnly = false,
}: {
  file: IdeallFile
  engineId: string
  readOnly?: boolean
}) {
  const active = useTabActive()
  const fileKey = fileRefKey(file.ref)
  const tabId = tabKey(fileEngineTab(file, engineId))
  const { fileSystemId, fileId } = file.ref
  const ref = React.useMemo(() => ({ fileSystemId, fileId }), [fileId, fileSystemId])
  const [document, setDocument] = React.useState(
    () =>
      readEngineSuspendSnapshot({
        tabId,
        engineId,
        fileKey,
        validate: isTextDraftDocument,
      }) ?? createTextDraftDocument({ fileKey, text: "", version: file.version }),
  )
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [suspendReady, setSuspendReady] = React.useState(false)
  const loadedFileKey = React.useRef<string | null>(null)
  const writable = !readOnly && file.capabilities.includes("write")
  const previewRange = React.useMemo(
    () => textPreviewRange(readOnly, file.size),
    [file.size, readOnly],
  )
  const previewTruncated = previewRange !== undefined
  const dirty = document.fileKey === fileKey && document.draft !== document.base
  const conflicted = document.fileKey === fileKey && document.pendingExternal != null

  React.useEffect(() => {
    let alive = true
    const identityChanged = loadedFileKey.current !== fileKey
    if (identityChanged) {
      setDocument((current) =>
        current.fileKey === fileKey
          ? current
          : createTextDraftDocument({ fileKey, text: "", version: file.version }),
      )
      setLoading(true)
    }
    setError(null)
    readFile(
      ref,
      { actor: "engine", permissions: [], activeFile: ref, intent: "content" },
      {
        encoding: "text",
        ...(previewRange ? { range: previewRange } : {}),
      },
    )
      .then(async (result) => {
        const text = await textFromData(result.data)
        if (!alive) return
        setDocument((current) =>
          reconcileTextDraft(current, {
            fileKey,
            text,
            version: result.version ?? file.version,
          }),
        )
        loadedFileKey.current = fileKey
      })
      .catch((reason) => {
        if (!alive) return
        const message = reason instanceof Error ? reason.message : String(reason)
        if (identityChanged) setError(message)
        else toast.error("刷新失败", { description: message })
      })
      .finally(() => {
        if (alive && identityChanged) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [file.version, fileKey, previewRange, ref])

  React.useEffect(() => {
    setTabDirty(tabId, dirty)
    if (dirty) promoteTab(tabId)
  }, [dirty, tabId])

  React.useEffect(() => {
    if (!dirty) {
      clearEngineSuspendSnapshot(tabId)
      setTabSuspendReady(tabId, false)
      setSuspendReady(false)
      return
    }
    // 输入期间先撤销 ready，避免 TabHost 在快照落后于编辑器时卸载；短暂空闲后再同步序列化。
    setTabSuspendReady(tabId, false)
    setSuspendReady(false)
    const timer = window.setTimeout(() => {
      const ready = writeEngineSuspendSnapshot({
        tabId,
        engineId,
        fileKey,
        payload: document,
      })
      setTabSuspendReady(tabId, ready)
      setSuspendReady(ready)
    }, 150)
    return () => window.clearTimeout(timer)
  }, [dirty, document, engineId, fileKey, tabId])

  const save = React.useCallback(async () => {
    if (!writable || !dirty || saving) return
    const savedDraft = document.draft
    const expectedVersion = document.version
    setSaving(true)
    try {
      const updated = await writeFile(
        ref,
        { data: savedDraft, mediaType: file.mediaType, expectedVersion },
        { actor: "engine", permissions: [], activeFile: ref, intent: "write" },
      )
      setDocument((current) =>
        current.fileKey === fileKey
          ? markTextDraftSaved(current, savedDraft, updated.version ?? expectedVersion)
          : current,
      )
      toast.success("已保存")
    } catch (reason) {
      toast.error("保存失败", {
        description: reason instanceof Error ? reason.message : String(reason),
      })
    } finally {
      setSaving(false)
    }
  }, [dirty, document.draft, document.version, file.mediaType, fileKey, ref, saving, writable])

  React.useEffect(() => {
    if (!active || !writable) return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [active, save, writable])

  const acceptExternal = () => {
    if (!conflicted) return
    if (!window.confirm("放弃当前草稿并载入外部版本？")) return
    setDocument(acceptExternalTextDraft)
  }

  if (loading || document.fileKey !== fileKey) {
    return <div className="h-full animate-pulse bg-muted/30" />
  }
  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b bg-muted/30 px-3 text-xs text-muted-foreground">
        <span
          className={
            conflicted
              ? "flex min-w-0 items-center gap-1.5 truncate text-amber-700 dark:text-amber-400"
              : undefined
          }
        >
          {conflicted && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
          {conflicted
            ? "外部版本已更新，草稿已保留"
            : writable
              ? dirty
                ? suspendReady
                  ? "未保存 · 可安全休眠"
                  : "未保存 · 草稿过大或暂存不可用，将保持运行"
                : "已保存"
              : "只读"}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {conflicted && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              title="放弃当前草稿并载入外部版本"
              onClick={acceptExternal}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              重新载入
            </Button>
          )}
          {writable && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              保存
            </Button>
          )}
        </div>
      </div>
      <CodeEditor
        value={document.draft}
        filename={file.name}
        language={file.mediaType}
        readOnly={!writable}
        onChange={(draft) => setDocument((current) => editTextDraft(current, draft))}
        className="min-h-0 flex-1"
      />
      {previewTruncated && (
        <div className="shrink-0 border-t bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          仅预览前 {formatBytes(TEXT_PREVIEW_LIMIT)}
        </div>
      )}
    </div>
  )
}
