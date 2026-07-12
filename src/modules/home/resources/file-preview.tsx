"use client"

// 旧节点文件查看器的兼容预览核心；新入口统一由 FileRef 交给 Engine/Display 渲染。
import * as React from "react"
import dynamic from "next/dynamic"
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react"
import type { FileRef } from "@protocol/file-system"
import type { StoredFile } from "@protocol/files"
import { readFile, statFile, watchFile } from "@/filesystem/registry"
import { fileReadResultToBlob } from "@/filesystem/read-result"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import { cn } from "@/lib/utils"
import { TEXT_PREVIEW_LIMIT } from "@/lib/file-preview"
import { formatBytes, fileTypeInfo } from "@/lib/format"
import { FileTypeBadge, FileTypeIcon } from "@/shared/file-type-icon"
import { Button } from "@/ui/button"

const JSON_FORMAT_LIMIT = 128 * 1024
const CSV_ROW_LIMIT = 200
const CSV_COLUMN_LIMIT = 64

const CodeEditor = dynamic(() => import("@/shared/code-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      正在加载预览...
    </div>
  ),
})

export type FilePreviewState = {
  file: StoredFile | null
  ref: FileRef
  version?: string
  url: string | null
  text: string | null
  textTruncated: boolean
  loading: boolean
  error: string | null
  reload: () => void
}

const UI_METADATA_CONTEXT = { actor: "ui", permissions: [], intent: "metadata" } as const
const UI_CONTENT_CONTEXT = { actor: "ui", permissions: [], intent: "content" } as const
const UI_WATCH_CONTEXT = { actor: "ui", permissions: [], intent: "watch" } as const

export function storedNodeFileRef(fileId: string): FileRef {
  return resourceFileRef({ scheme: "node", kind: "file", id: fileId })
}

export async function readStoredNodeFile(fileId: string): Promise<{
  file: StoredFile
  ref: FileRef
  version?: string
} | null> {
  const ref = storedNodeFileRef(fileId)
  const metadata = await statFile(ref, UI_METADATA_CONTEXT)
  if (!metadata) return null
  const result = await readFile(ref, UI_CONTENT_CONTEXT, { encoding: "binary" })
  const blob = fileReadResultToBlob(result)
  const expectedSize = result.size ?? metadata.size ?? 0
  if (blob.size === 0 && expectedSize > 0) {
    throw new Error("文件内容过大，当前文件系统未返回可读取内容")
  }
  const tags = metadata.properties?.tags
  return {
    ref,
    version: result.version ?? metadata.version,
    file: {
      id: fileId,
      name: metadata.name,
      type: metadata.mediaType,
      size: metadata.size ?? blob.size,
      blob,
      createdAt: metadata.createdAt ?? 0,
      tags: Array.isArray(tags) && tags.every((tag) => typeof tag === "string") ? [...tags] : [],
    },
  }
}

/**
 * 加载文件 + (文本类) 截断预览; 自动 createObjectURL / 卸载时 revoke。
 * key=fileId 重挂时由 useState 初值起步于 loading (调用方对切换文件用 key 重挂)。
 */
export function useFilePreview(fileId: string, revision = 0): FilePreviewState {
  const ref = React.useMemo(() => storedNodeFileRef(fileId), [fileId])
  const [reloadNonce, setReloadNonce] = React.useState(0)
  const [file, setFile] = React.useState<StoredFile | null>(null)
  const [url, setUrl] = React.useState<string | null>(null)
  const [text, setText] = React.useState<string | null>(null)
  const [textTruncated, setTextTruncated] = React.useState(false)
  const [version, setVersion] = React.useState<string | undefined>()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const reload = React.useCallback(() => setReloadNonce((v) => v + 1), [])

  React.useEffect(() => {
    let active = true
    let generation = 0
    let objectUrl: string | null = null
    setLoading(true)
    setError(null)
    const load = async () => {
      const currentGeneration = ++generation
      let nextObjectUrl: string | null = null
      try {
        const loaded = await readStoredNodeFile(fileId)
        if (!active || currentGeneration !== generation) return
        if (!loaded) {
          if (objectUrl) URL.revokeObjectURL(objectUrl)
          objectUrl = null
          setFile(null)
          setUrl(null)
          setText(null)
          setTextTruncated(false)
          setVersion(undefined)
          setLoading(false)
          return
        }
        const f = loaded.file
        nextObjectUrl = URL.createObjectURL(f.blob)
        let preview: string | null = null
        const type = fileTypeInfo(f.name, f.type)
        const canTextPreview =
          type.editable || ["markdown", "json", "csv", "code", "text", "svg"].includes(type.preview)
        if (canTextPreview) {
          preview = await f.blob.slice(0, TEXT_PREVIEW_LIMIT).text()
        }
        if (!active) {
          URL.revokeObjectURL(nextObjectUrl)
          return
        }
        if (currentGeneration !== generation) {
          URL.revokeObjectURL(nextObjectUrl)
          return
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = nextObjectUrl
        nextObjectUrl = null
        setFile(f)
        setUrl(objectUrl)
        setText(preview)
        setTextTruncated(f.size > TEXT_PREVIEW_LIMIT && preview !== null)
        setVersion(loaded.version)
        setLoading(false)
      } catch (e) {
        if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl)
        if (!active || currentGeneration !== generation) return
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = null
        if (active) {
          setFile(null)
          setUrl(null)
          setText(null)
          setTextTruncated(false)
          setVersion(undefined)
          setError(e instanceof Error ? e.message : "读取文件预览失败")
          setLoading(false)
        }
      }
    }
    void load()
    let watch: ReturnType<typeof watchFile> = null
    try {
      watch = watchFile(ref, UI_WATCH_CONTEXT, () => void load())
    } catch {
      // 首次读取仍可用于尚未实现 watch 的 provider。
    }
    return () => {
      active = false
      watch?.dispose()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileId, ref, revision, reloadNonce])

  return { file, ref, version, url, text, textTruncated, loading, error, reload }
}

/** 预览框 (按 mime 分派)；不含标题/下载, 供模态与标签复用。fill=true 时填满父高 (标签场景)。 */
export function FilePreviewBox({
  file,
  url,
  text,
  textTruncated,
  loading,
  error,
  reload,
  fill = false,
}: FilePreviewState & { fill?: boolean }) {
  const type = file ? fileTypeInfo(file.name, file.type) : null
  const maxH = fill ? "max-h-full" : "max-h-[60vh]"
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-auto rounded-md border border-border/60 bg-muted/40",
        fill ? "h-full" : "max-h-[60vh] min-h-[160px]",
      )}
    >
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : error ? (
        <PreviewError message={error} onRetry={reload} />
      ) : !file ? (
        <MissingPreview />
      ) : !url ? (
        <PreviewError message="无法创建文件预览资源。" onRetry={reload} />
      ) : type?.preview === "svg" && text !== null && !textTruncated ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={svgDataUrl(text)}
          alt={file.name}
          className={cn(maxH, "max-w-full object-contain")}
        />
      ) : type?.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className={cn(maxH, "max-w-full object-contain")} />
      ) : type?.preview === "video" ? (
        <video src={url} controls preload="none" className={cn(maxH, "w-full")} />
      ) : type?.preview === "audio" ? (
        <audio src={url} controls preload="none" className="w-full p-4" />
      ) : type?.preview === "pdf" ? (
        // sandbox (无 allow-scripts/allow-same-origin): blob: 与 app 文档同源, 不沙箱则一个 MIME 实为
        // text/html 却名为 .pdf 的文件会以 ideall origin 执行脚本、读 localStorage。
        <iframe
          src={url}
          title={file.name}
          sandbox=""
          className={cn(fill ? "h-full" : "h-[60vh]", "w-full")}
        />
      ) : type?.preview === "markdown" ? (
        <MarkdownPreview text={text ?? ""} truncated={textTruncated} />
      ) : type?.preview === "json" ? (
        <CodePreview
          filename={file.name}
          text={formatJsonForPreview(text ?? "", textTruncated)}
          language="JSON"
          truncated={textTruncated}
        />
      ) : type?.preview === "csv" ? (
        <CsvPreview text={text ?? ""} truncated={textTruncated} />
      ) : type?.preview === "code" ? (
        <CodePreview
          filename={file.name}
          text={text ?? ""}
          language={type.language ?? type.label}
          truncated={textTruncated}
        />
      ) : type?.preview === "text" ? (
        <CodePreview
          filename={file.name}
          text={text ?? ""}
          language={type.language ?? type.label}
          truncated={textTruncated}
        />
      ) : type?.preview === "font" ? (
        <FontPreview file={file} url={url} />
      ) : (
        <UnsupportedPreview file={file} />
      )}
    </div>
  )
}

function PreviewError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex max-w-md flex-col items-center gap-3 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-background text-amber-600">
        <AlertTriangle className="h-7 w-7" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">预览加载失败</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{message}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw className="mr-2 h-4 w-4" />
        重试
      </Button>
    </div>
  )
}

function MissingPreview() {
  return (
    <div className="flex max-w-md flex-col items-center gap-3 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-background text-muted-foreground">
        <AlertTriangle className="h-7 w-7" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">文件不可用</p>
        <p className="text-xs leading-relaxed text-muted-foreground">该文件不存在或已删除。</p>
      </div>
    </div>
  )
}

function CodePreview({
  filename,
  text,
  language,
  truncated,
}: {
  filename: string
  text: string
  language: string
  truncated: boolean
}) {
  const lines = countLines(text)
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-left">
      <div className="flex h-9 shrink-0 items-center justify-between border-b bg-muted/80 px-3 font-sans text-xs text-muted-foreground backdrop-blur">
        <span>{language}</span>
        <span>{lines} 行</span>
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor
          value={text}
          filename={filename}
          language={language}
          readOnly
          onChange={ignorePreviewChange}
          className="min-h-0 flex-1"
        />
      </div>
      {truncated && <TruncatedHint />}
    </div>
  )
}

function MarkdownPreview({ text, truncated }: { text: string; truncated: boolean }) {
  return (
    <div className="h-full w-full overflow-auto bg-background p-5 text-left">
      <div className="mx-auto max-w-3xl space-y-2">
        {text.split("\n").map((line, idx) => {
          if (line.startsWith("# "))
            return (
              <h1 key={idx} className="text-2xl font-semibold">
                {line.slice(2)}
              </h1>
            )
          if (line.startsWith("## "))
            return (
              <h2 key={idx} className="text-xl font-semibold">
                {line.slice(3)}
              </h2>
            )
          if (line.startsWith("### "))
            return (
              <h3 key={idx} className="text-lg font-semibold">
                {line.slice(4)}
              </h3>
            )
          if (line.startsWith("- ") || line.startsWith("* "))
            return (
              <p key={idx} className="pl-4 text-sm">
                • {line.slice(2)}
              </p>
            )
          if (line.startsWith("> "))
            return (
              <blockquote key={idx} className="border-l-2 pl-3 text-sm text-muted-foreground">
                {line.slice(2)}
              </blockquote>
            )
          if (!line.trim()) return <div key={idx} className="h-2" />
          return (
            <p key={idx} className="whitespace-pre-wrap break-words text-sm leading-7">
              {line}
            </p>
          )
        })}
        {truncated && <TruncatedHint />}
      </div>
    </div>
  )
}

function CsvPreview({ text, truncated }: { text: string; truncated: boolean }) {
  const parsed = parseDelimited(text)
  const clipped =
    parsed.length > CSV_ROW_LIMIT || parsed.some((row) => row.length > CSV_COLUMN_LIMIT)
  const rows = parsed.slice(0, CSV_ROW_LIMIT).map((row) => row.slice(0, CSV_COLUMN_LIMIT))
  return (
    <div className="h-full w-full overflow-auto bg-background text-left text-xs">
      <table className="w-full min-w-[640px] border-collapse">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={cn(rowIndex === 0 && "sticky top-0 bg-muted font-medium")}
            >
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border px-2 py-1 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(truncated || clipped) && (
        <TruncatedHint>
          仅显示前 {CSV_ROW_LIMIT} 行 / {CSV_COLUMN_LIMIT} 列
        </TruncatedHint>
      )}
    </div>
  )
}

function FontPreview({ file, url }: { file: StoredFile; url: string }) {
  const family = `ideall-font-${file.id.replace(/[^a-zA-Z0-9_-]/g, "")}`
  return (
    <div className="h-full w-full overflow-auto bg-background p-6 text-left">
      <style>{`@font-face{font-family:"${family}";src:url("${url}");}`}</style>
      <div className="space-y-5" style={{ fontFamily: `"${family}", sans-serif` }}>
        <p className="text-5xl leading-tight">Aa 字体预览 123</p>
        <p className="text-2xl leading-relaxed">The quick brown fox jumps over the lazy dog.</p>
        <p className="text-base leading-7 text-muted-foreground">
          ABCDEFGHIJKLMNOPQRSTUVWXYZ · abcdefghijklmnopqrstuvwxyz · 0123456789
        </p>
      </div>
    </div>
  )
}

function UnsupportedPreview({ file }: { file: StoredFile }) {
  const type = fileTypeInfo(file.name, file.type)
  return (
    <div className="flex max-w-md flex-col items-center gap-3 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-background">
        <FileTypeIcon name={file.name} type={file.type} className="h-9 w-9" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {type.label} · {formatBytes(file.size)}
        </p>
      </div>
      <FileTypeBadge name={file.name} type={file.type} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        该类型不能在浏览器内可靠预览，可下载后使用本机应用打开。
      </p>
    </div>
  )
}

function TruncatedHint({ children }: { children?: React.ReactNode }) {
  return (
    <div className="border-t bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      {children ?? `仅预览前 ${formatBytes(TEXT_PREVIEW_LIMIT)}`}
    </div>
  )
}

function formatJsonForPreview(text: string, truncated: boolean): string {
  if (truncated || text.length > JSON_FORMAT_LIMIT) return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function countLines(text: string): number {
  if (!text) return 0
  let count = 1
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1
  }
  return count
}

function ignorePreviewChange() {}

function parseDelimited(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? ""
  const delimiter = first.includes("\t") ? "\t" : ","
  return text
    .split(/\r?\n/)
    .filter((row) => row.length > 0)
    .map((row) => splitDelimitedRow(row, delimiter))
}

function splitDelimitedRow(row: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    const next = row[i + 1]
    if (ch === '"' && quoted && next === '"') {
      current += '"'
      i++
    } else if (ch === '"') {
      quoted = !quoted
    } else if (ch === delimiter && !quoted) {
      cells.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }
  cells.push(current.trim())
  return cells
}

function svgDataUrl(text: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
}

/** 触发浏览器下载 (沿用 file-manager 的延后 revoke, 避部分引擎同步 revoke 致下载中断)。 */
export function downloadStoredFile(file: StoredFile): void {
  const url = URL.createObjectURL(file.blob)
  const a = document.createElement("a")
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
