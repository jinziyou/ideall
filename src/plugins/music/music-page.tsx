"use client"

import * as React from "react"
import {
  FolderPlus,
  ListMusic,
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
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { Slider } from "@/ui/slider"
import { EmptyState } from "@/ui/empty-state"
import {
  addTrack,
  listTracks,
  loadPlaybackState,
  removeTrack,
  savePlaybackState,
  type Track,
} from "./music-store"

const AUDIO_EXTS = new Set(["mp3", "flac", "wav", "ogg", "m4a", "aac", "wma"])

export default function MusicPage() {
  const [tracks, setTracks] = React.useState<Track[]>([])
  const [currentId, setCurrentId] = React.useState<string | null>(null)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [volume, setVolume] = React.useState(0.8)
  const [repeat, setRepeat] = React.useState<"none" | "one" | "all">("none")
  const [shuffle, setShuffle] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const previousTracksRef = React.useRef<Track[]>([])

  const currentTrack = React.useMemo(
    () => tracks.find((t) => t.id === currentId) ?? null,
    [tracks, currentId],
  )

  const pendingTimeRef = React.useRef<number | null>(null)
  const shuffleSeedRef = React.useRef<number>(0)

  React.useEffect(() => {
    // 在 effect 内生成随机种子, 避免 render 期调用 Math.random。
    shuffleSeedRef.current = Math.floor(Math.random() * 1_000_000)
  }, [])

  React.useEffect(() => {
    let alive = true
    Promise.all([listTracks(), loadPlaybackState()])
      .then(([t, state]) => {
        if (!alive) return
        setTracks(t)
        if (state.currentTrackId && t.some((x) => x.id === state.currentTrackId)) {
          setCurrentId(state.currentTrackId)
          setCurrentTime(state.currentTime)
          pendingTimeRef.current = state.currentTime
        }
        setVolume(state.volume)
        setRepeat(state.repeat)
        setShuffle(state.shuffle)
      })
      .finally(() => setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  React.useEffect(() => {
    savePlaybackState({ currentTrackId: currentId, currentTime, volume, repeat, shuffle })
  }, [currentId, currentTime, volume, repeat, shuffle])

  React.useEffect(() => {
    const prev = previousTracksRef.current
    const next = tracks
    const removed = prev.filter((p) => !next.some((n) => n.id === p.id))
    for (const t of removed) {
      if (t.src.startsWith("blob:")) URL.revokeObjectURL(t.src)
    }
    previousTracksRef.current = next
  }, [tracks])

  React.useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentTrack) return
    if (audio.src !== currentTrack.src) {
      audio.src = currentTrack.src
      if (pendingTimeRef.current !== null) {
        audio.currentTime = pendingTimeRef.current
        pendingTimeRef.current = null
      }
    }
    if (isPlaying) {
      void audio.play()
    } else {
      audio.pause()
    }
  }, [currentTrack, isPlaying])

  React.useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = volume
  }, [volume])

  const playTrack = (id: string) => {
    if (currentId === id) {
      setIsPlaying((p) => !p)
      return
    }
    setCurrentId(id)
    pendingTimeRef.current = 0
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(true)
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      if (!AUDIO_EXTS.has(ext)) continue
      const src = URL.createObjectURL(file)
      await addTrack({
        title: file.name.replace(/\.[^.]+$/, ""),
        src,
      })
    }
    setTracks(await listTracks())
  }

  const handleRemove = async (id: string) => {
    await removeTrack(id)
    if (currentId === id) {
      setCurrentId(null)
      setIsPlaying(false)
      setCurrentTime(0)
      setDuration(0)
    }
    setTracks(await listTracks())
  }

  const playNext = () => {
    if (tracks.length === 0) return
    if (shuffle) {
      const idx = tracks.findIndex((t) => t.id === currentId)
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
    if (repeat === "all" || tracks.length > 1) {
      playNext()
      return
    }
    setIsPlaying(false)
    setCurrentTime(0)
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4">
      <PageHeader />

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
                添加文件
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex-1 animate-pulse rounded bg-muted/50" />
          ) : tracks.length === 0 ? (
            <EmptyState icon={ListMusic} title="播放列表为空，点击「添加文件」选择本地音频文件" />
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
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{currentTrack?.title ?? "未选择曲目"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {currentTrack ? formatTime(currentTime) + " / " + formatTime(duration) : "--:--"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setShuffle((s) => !s)}
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
            onValueChange={([v]) => {
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
                onValueChange={([v]) => setVolume(v / 100)}
              />
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={playPrev}
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                className="h-9 w-9"
                disabled={!currentTrack}
                onClick={() => setIsPlaying((p) => !p)}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={playNext}
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
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
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
  track: Track
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
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", active && "font-medium text-primary")}>
          {track.title}
        </p>
        {track.artist && <p className="truncate text-xs text-muted-foreground">{track.artist}</p>}
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
  if (!isFinite(seconds) || seconds < 0) return "00:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

function PageHeader() {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">音乐</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            播放本地音频文件。播放列表仅保存在本机。
          </p>
        </div>
      </div>
    </div>
  )
}
