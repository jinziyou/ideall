"use client"

import * as React from "react"
import {
  FileDown,
  FileAudio,
  FileUp,
  FolderPlus,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { downloadTextFile } from "@/lib/browser-download"
import { pluginDataFilename } from "@/plugins/shared/plugin-data"
import { Button } from "@/ui/button"
import { Slider } from "@/ui/slider"
import { EmptyState } from "@/ui/empty-state"
import {
  addAudioTrack,
  exportAudioLibraryJson,
  importAudioLibraryJson,
  isSupportedAudioFile,
  listAudioTracks,
  loadAudioPlaybackState,
  removeAudioTrack,
  saveAudioPlaybackState,
  updateAudioTrack,
  type AudioTrack,
} from "./audio-store"

export default function AudioPage() {
  const [tracks, setTracks] = React.useState<AudioTrack[]>([])
  const [currentId, setCurrentId] = React.useState<string | null>(null)
  const [currentSrc, setCurrentSrc] = React.useState("")
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [volume, setVolume] = React.useState(0.8)
  const [repeat, setRepeat] = React.useState<"none" | "one" | "all">("none")
  const [shuffle, setShuffle] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const jsonInputRef = React.useRef<HTMLInputElement>(null)
  const pendingTimeRef = React.useRef<number | null>(null)
  const shuffleSeedRef = React.useRef(0)

  const currentTrack = React.useMemo(
    () => tracks.find((t) => t.id === currentId) ?? null,
    [tracks, currentId],
  )

  React.useEffect(() => {
    shuffleSeedRef.current = Math.floor(Math.random() * 1_000_000)
  }, [])

  const applyLibraryState = React.useCallback(
    (savedTracks: AudioTrack[], state: Awaited<ReturnType<typeof loadAudioPlaybackState>>) => {
      setTracks(savedTracks)
      const savedTrack = state.currentTrackId
        ? savedTracks.find((t) => t.id === state.currentTrackId)
        : null
      if (savedTrack) {
        setCurrentId(savedTrack.id)
        setCurrentTime(state.currentTime)
        pendingTimeRef.current = state.currentTime
        setDuration(savedTrack.duration ?? 0)
      } else {
        setCurrentId(null)
        setCurrentTime(0)
        pendingTimeRef.current = null
        setDuration(0)
      }
      setVolume(state.volume)
      setRepeat(state.repeat)
      setShuffle(state.shuffle)
    },
    [],
  )

  const loadLibrary = React.useCallback(async () => {
    const [savedTracks, state] = await Promise.all([listAudioTracks(), loadAudioPlaybackState()])
    applyLibraryState(savedTracks, state)
  }, [applyLibraryState])

  React.useEffect(() => {
    let alive = true
    Promise.all([listAudioTracks(), loadAudioPlaybackState()])
      .then(([savedTracks, state]) => {
        if (!alive) return
        applyLibraryState(savedTracks, state)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [applyLibraryState])

  React.useEffect(() => {
    saveAudioPlaybackState({ currentTrackId: currentId, currentTime, volume, repeat, shuffle })
  }, [currentId, currentTime, volume, repeat, shuffle])

  React.useEffect(() => {
    if (!currentTrack) {
      setCurrentSrc("")
      return
    }
    const url = URL.createObjectURL(currentTrack.blob)
    setCurrentSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [currentTrack])

  React.useEffect(() => {
    setDuration(currentTrack?.duration ?? 0)
  }, [currentTrack])

  React.useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!currentSrc) {
      audio.removeAttribute("src")
      audio.load()
      return
    }
    if (audio.src !== currentSrc) audio.src = currentSrc
    if (isPlaying) {
      void audio.play().catch(() => setIsPlaying(false))
    } else {
      audio.pause()
    }
  }, [currentSrc, isPlaying])

  React.useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = volume
  }, [volume])

  const refreshTracks = React.useCallback(async () => {
    setTracks(await listAudioTracks())
  }, [])

  const playTrack = (id: string) => {
    if (currentId === id) {
      setIsPlaying((p) => !p)
      return
    }
    setCurrentId(id)
    pendingTimeRef.current = 0
    setCurrentTime(0)
    setDuration(tracks.find((t) => t.id === id)?.duration ?? 0)
    setIsPlaying(true)
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      if (!isSupportedAudioFile(file)) continue
      await addAudioTrack(file)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
    await refreshTracks()
  }

  const handleRemove = async (id: string) => {
    await removeAudioTrack(id)
    if (currentId === id) {
      setCurrentId(null)
      setIsPlaying(false)
      setCurrentTime(0)
      setDuration(0)
    }
    await refreshTracks()
  }

  const handleExportJson = async () => {
    try {
      downloadTextFile(pluginDataFilename("ideall-audio"), await exportAudioLibraryJson())
      toast("已导出音频库 JSON")
    } catch (e) {
      toast.error("导出失败", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const handleImportJson = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      setIsPlaying(false)
      const result = await importAudioLibraryJson(await file.text())
      await loadLibrary()
      if (result.tracks === 0) setCurrentSrc("")
      toast(`已导入 ${result.tracks} 首音频`)
    } catch (e) {
      toast.error("导入失败", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      if (jsonInputRef.current) jsonInputRef.current.value = ""
    }
  }

  const playNext = () => {
    if (tracks.length === 0) return
    if (shuffle) {
      const idx = Math.max(
        0,
        tracks.findIndex((t) => t.id === currentId),
      )
      const offset = shuffleSeedRef.current % tracks.length || 1
      const next = tracks[(idx + offset) % tracks.length]
      shuffleSeedRef.current = Math.floor(shuffleSeedRef.current * 1.2 + 7)
      playTrack(next.id)
      return
    }
    const idx = tracks.findIndex((t) => t.id === currentId)
    const next = tracks[(idx + 1) % tracks.length]
    playTrack(next.id)
  }

  const playPrev = () => {
    if (tracks.length === 0) return
    const idx = tracks.findIndex((t) => t.id === currentId)
    const prev = tracks[(idx - 1 + tracks.length) % tracks.length]
    playTrack(prev.id)
  }

  const onEnded = () => {
    if (repeat === "one") {
      const audio = audioRef.current
      if (audio) {
        audio.currentTime = 0
        void audio.play()
      }
      return
    }
    const idx = tracks.findIndex((t) => t.id === currentId)
    if (repeat === "all" || (idx >= 0 && idx < tracks.length - 1)) {
      playNext()
      return
    }
    setIsPlaying(false)
    setCurrentTime(0)
  }

  const onLoadedMetadata = async (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget
    const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0
    setDuration(nextDuration)
    if (currentTrack && nextDuration && currentTrack.duration !== nextDuration) {
      const updated = await updateAudioTrack(currentTrack.id, { duration: nextDuration })
      if (updated) {
        setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
      }
    }
    if (pendingTimeRef.current !== null) {
      audio.currentTime = Math.min(pendingTimeRef.current, nextDuration || pendingTimeRef.current)
      pendingTimeRef.current = null
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4">
      <PageHeader
        onImport={() => jsonInputRef.current?.click()}
        onExport={() => void handleExportJson()}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void handleImportJson(e.target.files)}
      />

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border border-border/60 bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">播放列表</h2>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="audio/*"
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => fileInputRef.current?.click()}
              >
                <FolderPlus className="h-4 w-4" />
                导入音频
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex-1 animate-pulse rounded bg-muted/50" />
          ) : tracks.length === 0 ? (
            <EmptyState icon={FileAudio} title="还没有音频文件" />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="flex flex-col gap-1">
                {tracks.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    active={track.id === currentId}
                    playing={track.id === currentId && isPlaying}
                    onPlay={() => playTrack(track.id)}
                    onRemove={() => void handleRemove(track.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 rounded-lg border border-border/60 bg-card p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <FileAudio className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {currentTrack?.title ?? "未选择音频"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {currentTrack ? `${formatTime(currentTime)} / ${formatTime(duration)}` : "--:--"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setShuffle((s) => !s)}
                aria-label="随机播放"
                aria-pressed={shuffle}
              >
                <Shuffle className={cn("h-4 w-4", shuffle && "text-primary")} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() =>
                  setRepeat((r) => (r === "none" ? "all" : r === "all" ? "one" : "none"))
                }
                aria-label="循环模式"
              >
                {repeat === "one" ? (
                  <Repeat1 className="h-4 w-4 text-primary" />
                ) : (
                  <Repeat className={cn("h-4 w-4", repeat === "all" && "text-primary")} />
                )}
              </Button>
            </div>
          </div>

          <Slider
            value={[currentTime]}
            max={Math.max(duration, 1)}
            step={1}
            disabled={!currentTrack}
            onValueChange={([v]: number[]) => {
              setCurrentTime(v)
              if (audioRef.current) audioRef.current.currentTime = v
            }}
          />

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              <Slider
                className="w-28"
                value={[volume * 100]}
                max={100}
                step={1}
                onValueChange={([v]: number[]) => setVolume(v / 100)}
              />
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={playPrev}
                aria-label="上一首"
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                className="h-9 w-9"
                disabled={!currentTrack}
                onClick={() => setIsPlaying((p) => !p)}
                aria-label={isPlaying ? "暂停" : "播放"}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={playNext}
                aria-label="下一首"
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => void onLoadedMetadata(e)}
        onEnded={onEnded}
        preload="metadata"
      />
    </div>
  )
}

function TrackRow({
  track,
  active,
  playing,
  onPlay,
  onRemove,
}: {
  track: AudioTrack
  active: boolean
  playing: boolean
  onPlay: () => void
  onRemove: () => void
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        aria-label={playing ? "暂停" : "播放"}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", active && "font-medium text-primary")}>
          {track.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[formatBytes(track.size), track.duration ? formatTime(track.duration) : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="移除"
      >
        <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
      </button>
    </div>
  )
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function PageHeader({ onImport, onExport }: { onImport: () => void; onExport: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">音频播放器</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            本地播放列表 · IndexedDB 持久化
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onImport}>
            <FileUp className="h-4 w-4" />
            导入 JSON
          </Button>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onExport}>
            <FileDown className="h-4 w-4" />
            导出 JSON
          </Button>
        </div>
      </div>
    </div>
  )
}
