"use client"

import * as React from "react"
import { FileAudio, LoaderCircle, Pause, Play, Volume2 } from "lucide-react"
import type { IdeallFile } from "@protocol/file-system"
import { readFile } from "@/filesystem/registry"
import { base64ToBytes } from "@/lib/base64"
import { formatDurationSeconds } from "@/lib/format"
import { audioTrackIdFromRef } from "@/plugins/audio/audio-file-system"
import {
  audioFilePlaybackKey,
  audioLibraryPlaybackKey,
  type AudioPlaybackSource,
  useAudioPlayback,
} from "@/plugins/audio/audio-playback"
import { Button } from "@/ui/button"
import { Slider } from "@/ui/slider"

function playbackSource(file: IdeallFile, blob: Blob): AudioPlaybackSource {
  const trackId = audioTrackIdFromRef(file.ref)
  return {
    key: trackId ? audioLibraryPlaybackKey(trackId) : audioFilePlaybackKey(file.ref, file.version),
    kind: trackId ? "library" : "file",
    trackId: trackId ?? undefined,
    title: file.name,
    mediaType: file.mediaType,
    blob,
  }
}

export default function AudioFileEngine({ file }: { file: IdeallFile }) {
  const playback = useAudioPlayback()
  const [source, setSource] = React.useState<AudioPlaybackSource | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [readError, setReadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    setSource(null)
    setReadError(null)
    setLoading(true)
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
        setSource(playbackSource(file, blob))
      })
      .catch((reason) => {
        if (alive) setReadError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [file])

  const active = source !== null && playback.source?.key === source.key
  const playing = active && playback.isPlaying
  const duration = active
    ? playback.duration
    : typeof file.properties?.duration === "number"
      ? file.properties.duration
      : 0
  const currentTime = active ? playback.currentTime : 0
  const error = readError ?? (active ? playback.error : null)

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center p-6">
      <div className="flex w-full max-w-xl flex-col items-center gap-5 rounded-lg border bg-card p-8 text-center shadow-sm">
        <span className="grid h-20 w-20 place-items-center rounded-full bg-primary/10 text-primary">
          <FileAudio className="h-9 w-9" />
        </span>
        <div className="min-w-0 max-w-full">
          <h1 className="truncate text-lg font-semibold">{file.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{file.mediaType}</p>
        </div>

        <div className="flex w-full flex-col gap-3">
          <Slider
            value={[currentTime]}
            max={Math.max(duration, 1)}
            step={1}
            disabled={!active || !duration}
            aria-label="播放进度"
            onValueChange={([value]: number[]) => playback.seek(value)}
          />
          <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
            <span>
              {formatDurationSeconds(currentTime)} / {formatDurationSeconds(duration)}
            </span>
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4" />
              <Slider
                className="w-28"
                value={[playback.volume * 100]}
                max={100}
                step={1}
                aria-label="音量"
                onValueChange={([value]: number[]) => playback.setVolume(value / 100)}
              />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          type="button"
          size="lg"
          className="gap-2"
          disabled={!source || loading}
          onClick={() => source && void playback.toggleSource(source)}
        >
          {loading || (active && playback.isLoading) ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {playing ? "暂停" : "播放"}
        </Button>
      </div>
    </div>
  )
}
