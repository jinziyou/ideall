"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import type { IdeallFile } from "@protocol/file-system"
import { readFile, writeFile } from "@/filesystem/registry"
import { base64ToBytes } from "@/lib/base64"
import { Button } from "@/ui/button"

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
  readOnly = false,
}: {
  file: IdeallFile
  readOnly?: boolean
}) {
  const [base, setBase] = React.useState("")
  const [draft, setDraft] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const writable = !readOnly && file.capabilities.includes("write")
  const { fileSystemId, fileId } = file.ref

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    readFile(
      { fileSystemId, fileId },
      { actor: "engine", permissions: [], activeFile: file.ref, intent: "content" },
      { encoding: "text" },
    )
      .then(async (result) => {
        const text = await textFromData(result.data)
        if (!alive) return
        setBase(text)
        setDraft(text)
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [file.ref, fileId, fileSystemId])

  const save = async () => {
    if (!writable || draft === base || saving) return
    setSaving(true)
    try {
      await writeFile(
        file.ref,
        { data: draft, mediaType: file.mediaType },
        { actor: "engine", permissions: [], activeFile: file.ref, intent: "write" },
      )
      setBase(draft)
      toast.success("已保存")
    } catch (reason) {
      toast.error("保存失败", {
        description: reason instanceof Error ? reason.message : String(reason),
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="h-full animate-pulse bg-muted/30" />
  }
  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b bg-muted/30 px-3 text-xs text-muted-foreground">
        <span>{writable ? (draft === base ? "已保存" : "未保存") : "只读"}</span>
        {writable && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={draft === base || saving}
            onClick={() => void save()}
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            保存
          </Button>
        )}
      </div>
      <CodeEditor
        value={draft}
        filename={file.name}
        language={file.mediaType}
        readOnly={!writable}
        onChange={setDraft}
        className="min-h-0 flex-1"
      />
    </div>
  )
}
