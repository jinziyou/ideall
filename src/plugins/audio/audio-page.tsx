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
import { formatDurationSeconds } from "@/lib/format"
import { pluginDataFilename } from "@/plugins/shared/plugin-data"
import { Button } from "@/ui/button"
import { Slider } from "@/ui/slider"
import { EmptyState } from "@/ui/empty-state"
import {
  invokeFileAction,
  readFile,
  readFileDirectory,
  statFile,
  writeFile,
} from "@/filesystem/registry"
import { audioLibraryRootRef, audioTrackRef } from "./audio-file-system"
import {
  audioLibraryPlaybackKey,
  type AudioPlaybackSource,
  useAudioPlayback,
} from "./audio-playback"
import { isSupportedAudioFile, type AudioPlaybackState, type AudioTrack } from "./audio-store"

const UI_READ_CONTEXT = { actor: "ui", permissions: [], intent: "content" } as const
const UI_DIRECTORY_CONTEXT = { actor: "ui", permissions: [], intent: "directory" } as const
const UI_WRITE_CONTEXT = { actor: "ui", permissions: [], intent: "write" } as const
const UI_ACTION_CONTEXT = { actor: "ui", permissions: [], intent: "action" } as const

async function loadAudioTracksFromFileSystem(): Promise<AudioTrack[]> {
  const page = await readFileDirectory(audioLibraryRootRef, UI_DIRECTORY_CONTEXT)
  return Promise.all(
    page.entries.map(async (entry) => {
      const [file, content] = await Promise.all([
        statFile(entry.target, { actor: "ui", permissions: [], intent: "metadata" }),
        readFile(entry.target, UI_READ_CONTEXT, { encoding: "binary" }),
      ])
      if (!file || !(content.data instanceof Blob)) {
        throw new Error(`音频文件不可读: ${entry.name}`)
      }
      return {
        id: entry.entryId,
        title: file.name,
        artist: typeof file.properties?.artist === "string" ? file.properties.artist : undefined,
        album: typeof file.properties?.album === "string" ? file.properties.album : undefined,
        mime: file.mediaType,
        size: file.size ?? content.data.size,
        duration:
          typeof file.properties?.duration === "number" ? file.properties.duration : undefined,
        blob: content.data,
        createdAt: file.createdAt ?? 0,
        updatedAt: file.updatedAt ?? (Number(file.version) || 0),
      }
    }),
  )
}

async function loadAudioPlaybackFromFileSystem(): Promise<AudioPlaybackState> {
  const result = await readFile(audioLibraryRootRef, UI_READ_CONTEXT, { encoding: "json" })
  return result.data as AudioPlaybackState
}

function trackPlaybackSource(track: AudioTrack): AudioPlaybackSource {
  return {
    key: audioLibraryPlaybackKey(track.id),
    kind: "library",
    trackId: track.id,
    title: track.title,
    mediaType: track.mime,
    blob: track.blob,
  }
}

export default function AudioPage({ embedded = false }: { embedded?: boolean } = {}) {
  const {
    source: activeSource,
    isPlaying: controllerIsPlaying,
    currentTime: controllerTime,
    duration: controllerDuration,
    volume,
    repeat,
    shuffle,
    error: playbackError,
    endedRevision,
    metadataRevision,
    activateSource,
    toggleSource,
    play,
    seek,
    setVolume,
    setRepeat,
    setShuffle,
    clearSource,
    consumeEnded,
    consumeMetadata,
  } = useAudioPlayback()
  const [tracks, setTracks] = React.useState<AudioTrack[]>([])
  const [currentId, setCurrentId] = React.useState<string | null>(null)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const jsonInputRef = React.useRef<HTMLInputElement>(null)
  const shuffleSeedRef = React.useRef(0)

  const currentTrack = React.useMemo(
    () => tracks.find((t) => t.id === currentId) ?? null,
    [tracks, currentId],
  )
  const currentSourceKey = currentTrack ? audioLibraryPlaybackKey(currentTrack.id) : null
  const isCurrentTrackActive = activeSource?.key === currentSourceKey
  const isPlaying = isCurrentTrackActive && controllerIsPlaying

  React.useEffect(() => {
    shuffleSeedRef.current = Math.floor(Math.random() * 1_000_000)
  }, [])

  const applyLibraryState = React.useCallback(
    (savedTracks: AudioTrack[], state: AudioPlaybackState) => {
      setTracks(savedTracks)
      const savedTrack = state.currentTrackId
        ? savedTracks.find((t) => t.id === state.currentTrackId)
        : null
      if (savedTrack) {
        setCurrentId(savedTrack.id)
        setCurrentTime(state.currentTime)
        setDuration(savedTrack.duration ?? 0)
        void activateSource(trackPlaybackSource(savedTrack), {
          startTime: state.currentTime,
          ifIdle: true,
        })
      } else {
        setCurrentId(null)
        setCurrentTime(0)
        setDuration(0)
      }
      setVolume(state.volume)
      setRepeat(state.repeat)
      setShuffle(state.shuffle)
    },
    [activateSource, setRepeat, setShuffle, setVolume],
  )

  const loadLibrary = React.useCallback(async () => {
    const [savedTracks, state] = await Promise.all([
      loadAudioTracksFromFileSystem(),
      loadAudioPlaybackFromFileSystem(),
    ])
    applyLibraryState(savedTracks, state)
  }, [applyLibraryState])

  React.useEffect(() => {
    let alive = true
    Promise.all([loadAudioTracksFromFileSystem(), loadAudioPlaybackFromFileSystem()])
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
    if (loading) return
    void writeFile(
      audioLibraryRootRef,
      {
        data: {
          currentTrackId: currentId,
          currentTime,
          volume,
          repeat,
          shuffle,
        },
      },
      UI_WRITE_CONTEXT,
    ).catch(() => {})
  }, [currentId, currentTime, loading, repeat, shuffle, volume])

  React.useEffect(() => {
    const activeTrackId = activeSource?.kind === "library" ? activeSource.trackId : null
    if (!activeTrackId || !tracks.some((track) => track.id === activeTrackId)) return
    setCurrentId(activeTrackId)
    setCurrentTime(controllerTime)
    setDuration(
      controllerDuration || tracks.find((track) => track.id === activeTrackId)?.duration || 0,
    )
  }, [activeSource, controllerDuration, controllerTime, tracks])

  const refreshTracks = React.useCallback(async () => {
    setTracks(await loadAudioTracksFromFileSystem())
  }, [])

  const playTrack = React.useCallback(
    (id: string) => {
      const track = tracks.find((item) => item.id === id)
      if (!track) return
      const selectedAlready = currentId === id
      setCurrentId(id)
      if (!selectedAlready) {
        setCurrentTime(0)
        setDuration(track.duration ?? 0)
      }
      void toggleSource(trackPlaybackSource(track), {
        startTime: selectedAlready ? currentTime : 0,
      })
    },
    [currentId, currentTime, toggleSource, tracks],
  )

  const handleFiles = async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      if (!isSupportedAudioFile(file)) continue
      await invokeFileAction(audioLibraryRootRef, "add-track", file, UI_ACTION_CONTEXT)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
    await refreshTracks()
  }

  const handleRemove = async (id: string) => {
    await invokeFileAction(audioTrackRef(id), "delete", undefined, UI_ACTION_CONTEXT)
    if (currentId === id) {
      clearSource(audioLibraryPlaybackKey(id))
      setCurrentId(null)
      setCurrentTime(0)
      setDuration(0)
    }
    await refreshTracks()
  }

  const handleExportJson = async () => {
    try {
      const json = await invokeFileAction(
        audioLibraryRootRef,
        "export",
        undefined,
        UI_ACTION_CONTEXT,
      )
      if (typeof json !== "string") throw new Error("音频文件系统未返回导出内容")
      downloadTextFile(pluginDataFilename("ideall-audio"), json)
      toast("已导出音频库 JSON")
    } catch (e) {
      toast.error("导出失败", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const handleImportJson = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      clearSource()
      const result = (await invokeFileAction(
        audioLibraryRootRef,
        "import",
        await file.text(),
        UI_ACTION_CONTEXT,
      )) as { tracks: number }
      await loadLibrary()
      toast(`已导入 ${result.tracks} 首音频`)
    } catch (e) {
      toast.error("导入失败", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      if (jsonInputRef.current) jsonInputRef.current.value = ""
    }
  }

  const playNext = React.useCallback(() => {
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
  }, [currentId, playTrack, shuffle, tracks])

  const playPrev = React.useCallback(() => {
    if (tracks.length === 0) return
    const idx = tracks.findIndex((t) => t.id === currentId)
    const prev = tracks[(idx - 1 + tracks.length) % tracks.length]
    playTrack(prev.id)
  }, [currentId, playTrack, tracks])

  React.useEffect(() => {
    if (
      endedRevision === 0 ||
      activeSource?.kind !== "library" ||
      activeSource.trackId !== currentId
    ) {
      return
    }
    if (!consumeEnded(endedRevision)) return
    if (repeat === "one") {
      seek(0)
      void play()
      return
    }
    const idx = tracks.findIndex((track) => track.id === currentId)
    if (repeat === "all" || (idx >= 0 && idx < tracks.length - 1)) {
      playNext()
      return
    }
    seek(0)
  }, [activeSource, consumeEnded, currentId, endedRevision, play, playNext, repeat, seek, tracks])

  React.useEffect(() => {
    if (
      metadataRevision === 0 ||
      activeSource?.kind !== "library" ||
      !activeSource.trackId ||
      !controllerDuration
    ) {
      return
    }
    const track = tracks.find((item) => item.id === activeSource.trackId)
    if (!track || track.duration === controllerDuration) return
    if (!consumeMetadata(metadataRevision)) return
    void writeFile(
      audioTrackRef(track.id),
      { data: { duration: controllerDuration }, expectedVersion: String(track.updatedAt) },
      UI_WRITE_CONTEXT,
    )
      .then((updated) => {
        setTracks((previous) =>
          previous.map((item) =>
            item.id === track.id
              ? {
                  ...item,
                  duration: controllerDuration,
                  updatedAt: updated.updatedAt ?? (Number(updated.version) || Date.now()),
                }
              : item,
          ),
        )
      })
      .catch(() => {})
  }, [activeSource, consumeMetadata, controllerDuration, metadataRevision, tracks])

  return (
    <div
      className={cn(
        "mx-auto flex h-full w-full flex-col",
        embedded ? "max-w-none gap-3 p-3" : "max-w-5xl gap-4",
      )}
    >
      {!embedded && (
        <PageHeader
          onImport={() => jsonInputRef.current?.click()}
          onExport={() => void handleExportJson()}
        />
      )}
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
                  {currentTrack
                    ? `${formatDurationSeconds(currentTime)} / ${formatDurationSeconds(duration)}`
                    : "--:--"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setShuffle(!shuffle)}
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
                  setRepeat(repeat === "none" ? "all" : repeat === "all" ? "one" : "none")
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
            disabled={!currentTrack || !isCurrentTrackActive}
            onValueChange={([v]: number[]) => {
              setCurrentTime(v)
              seek(v)
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
                onClick={() => currentTrack && playTrack(currentTrack.id)}
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
          {isCurrentTrackActive && playbackError && (
            <p className="text-xs text-destructive">{playbackError}</p>
          )}
        </div>
      </div>
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
          {[formatBytes(track.size), track.duration ? formatDurationSeconds(track.duration) : null]
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
