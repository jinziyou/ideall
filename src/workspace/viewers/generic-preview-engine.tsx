"use client"

import * as React from "react"
import { Download, FileQuestion, Loader2 } from "lucide-react"
import type { IdeallFile } from "@protocol/file-system"
import { readFile } from "@/filesystem/registry"
import { Button } from "@/ui/button"
import { fileReadResultToBlob } from "@/filesystem/read-result"

export default function GenericPreviewEngine({ file }: { file: IdeallFile }) {
  const [url, setUrl] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const { fileSystemId, fileId } = file.ref
  const { mediaType, version } = file

  React.useEffect(() => {
    let alive = true
    let objectUrl = ""
    setError(null)
    setUrl("")
    readFile(
      { fileSystemId, fileId },
      {
        actor: "engine",
        permissions: [],
        activeFile: { fileSystemId, fileId },
        intent: "content",
      },
      { encoding: "binary" },
    )
      .then((result) => {
        const nextUrl = URL.createObjectURL(fileReadResultToBlob(result))
        if (!alive) {
          URL.revokeObjectURL(nextUrl)
          return
        }
        objectUrl = nextUrl
        setUrl(nextUrl)
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileId, fileSystemId, mediaType, version])

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>
  if (!url) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (file.mediaType.startsWith("image/")) {
    // Blob URL 由当前 FileRef 读取生成，不经过远端图片域名白名单。
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={file.name} className="h-full w-full object-contain p-4" />
  }
  if (file.mediaType.startsWith("video/")) {
    return <video src={url} controls className="h-full w-full object-contain p-4" />
  }
  if (file.mediaType === "application/pdf") {
    return <iframe src={url} title={file.name} sandbox="" className="h-full w-full border-0" />
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <FileQuestion className="h-10 w-10 text-muted-foreground" />
      <div>
        <h1 className="font-medium">{file.name}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{file.mediaType}</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <a href={url} download={file.name}>
          <Download className="mr-2 h-4 w-4" />
          下载
        </a>
      </Button>
    </div>
  )
}
