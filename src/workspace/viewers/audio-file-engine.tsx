"use client"

import * as React from "react"
import { FileAudio, Pause, Play } from "lucide-react"
import type { IdeallFile } from "@protocol/file-system"
import { readFile } from "@/filesystem/registry"
import { base64ToBytes } from "@/lib/base64"
import { Button } from "@/ui/button"

export default function AudioFileEngine({ file }: { file: IdeallFile }) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [src, setSrc] = React.useState("")
  const [playing, setPlaying] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    let url = ""
    readFile(
      file.ref,
      { actor: "engine", permissions: [], activeFile: file.ref, intent: "content" },
      { encoding: "binary" },
    )
      .then((result) => {
        if (!alive) return
        let blob: Blob
        if (result.data instanceof Blob) {
          blob = result.data
        } else if (
          result.data &&
          typeof result.data === "object" &&
          "base64" in result.data &&
          typeof result.data.base64 === "string"
        ) {
          const bytes = base64ToBytes(result.data.base64)
          const buffer = new ArrayBuffer(bytes.byteLength)
          new Uint8Array(buffer).set(bytes)
          blob = new Blob([buffer], { type: result.mediaType })
        } else {
          throw new Error("文件系统未返回可播放的音频 Blob")
        }
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [file])

  const toggle = async () => {
    const audio = audioRef.current
    if (!audio || !src) return
    if (audio.paused) {
      await audio.play()
      setPlaying(true)
    } else {
      audio.pause()
      setPlaying(false)
    }
  }

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center p-6">
      <div className="flex w-full max-w-xl flex-col items-center gap-5 rounded-xl border bg-card p-8 text-center shadow-sm">
        <span className="grid h-20 w-20 place-items-center rounded-full bg-primary/10 text-primary">
          <FileAudio className="h-9 w-9" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{file.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{file.mediaType}</p>
        </div>
        <audio
          ref={audioRef}
          src={src || undefined}
          controls
          className="w-full"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <Button
          type="button"
          size="lg"
          className="gap-2"
          disabled={!src}
          onClick={() => void toggle()}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {playing ? "暂停" : "播放"}
        </Button>
      </div>
    </div>
  )
}
