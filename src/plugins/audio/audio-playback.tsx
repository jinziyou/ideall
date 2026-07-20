"use client"

import * as React from "react"
import { fileRefKey, type FileRef } from "@protocol/file-system"

export type AudioPlaybackSource = {
  key: string
  kind: "library" | "file"
  title: string
  mediaType: string
  blob: Blob
  trackId?: string
}

export type ActivateAudioSourceOptions = {
  autoplay?: boolean
  force?: boolean
  ifIdle?: boolean
  startTime?: number
}

export type AudioRepeatMode = "none" | "one" | "all"

export type AudioPlaybackController = {
  source: AudioPlaybackSource | null
  isPlaying: boolean
  isLoading: boolean
  currentTime: number
  duration: number
  volume: number
  repeat: AudioRepeatMode
  shuffle: boolean
  error: string | null
  endedRevision: number
  metadataRevision: number
  activateSource: (
    source: AudioPlaybackSource,
    options?: ActivateAudioSourceOptions,
  ) => Promise<void>
  toggleSource: (
    source: AudioPlaybackSource,
    options?: Omit<ActivateAudioSourceOptions, "autoplay">,
  ) => Promise<void>
  play: () => Promise<void>
  pause: () => void
  seek: (time: number) => void
  setVolume: (volume: number) => void
  setRepeat: (repeat: AudioRepeatMode) => void
  setShuffle: (shuffle: boolean) => void
  clearSource: (sourceKey?: string) => void
  consumeEnded: (revision: number) => boolean
  consumeMetadata: (revision: number) => boolean
}

const AudioPlaybackContext = React.createContext<AudioPlaybackController | null>(null)

export function audioLibraryPlaybackKey(trackId: string): string {
  return `library:${trackId}`
}

export function audioFilePlaybackKey(ref: FileRef, version?: string | null): string {
  return `file:${fileRefKey(ref)}:${version ?? "current"}`
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0.8
  return Math.min(1, Math.max(0, volume))
}

function mediaErrorMessage(error: MediaError | null): string {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "音频加载已中止"
    case MediaError.MEDIA_ERR_NETWORK:
      return "音频加载失败"
    case MediaError.MEDIA_ERR_DECODE:
      return "音频格式无法解码"
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "音频格式不受支持"
    default:
      return "音频播放失败"
  }
}

export function AudioPlaybackProvider({ children }: { children: React.ReactNode }) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const sourceRef = React.useRef<AudioPlaybackSource | null>(null)
  const sourceUrlRef = React.useRef("")
  const pendingTimeRef = React.useRef<number | null>(null)
  const consumedEndedRevisionRef = React.useRef(0)
  const consumedMetadataRevisionRef = React.useRef(0)
  const [source, setSource] = React.useState<AudioPlaybackSource | null>(null)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [volume, setVolumeState] = React.useState(0.8)
  const [repeat, setRepeat] = React.useState<AudioRepeatMode>("none")
  const [shuffle, setShuffle] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [endedRevision, setEndedRevision] = React.useState(0)
  const [metadataRevision, setMetadataRevision] = React.useState(0)

  const releaseSourceUrl = React.useCallback(() => {
    if (!sourceUrlRef.current) return
    URL.revokeObjectURL(sourceUrlRef.current)
    sourceUrlRef.current = ""
  }, [])

  const play = React.useCallback(async () => {
    const audio = audioRef.current
    if (!audio || !sourceRef.current) return
    try {
      await audio.play()
      setError(null)
    } catch (reason) {
      setIsPlaying(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  const pause = React.useCallback(() => {
    audioRef.current?.pause()
  }, [])

  const activateSource = React.useCallback(
    async (nextSource: AudioPlaybackSource, options: ActivateAudioSourceOptions = {}) => {
      const audio = audioRef.current
      if (!audio) return
      const current = sourceRef.current
      if (options.ifIdle && current) return

      const sourceChanged = options.force || current?.key !== nextSource.key
      if (sourceChanged) {
        audio.pause()
        releaseSourceUrl()
        const url = URL.createObjectURL(nextSource.blob)
        sourceUrlRef.current = url
        sourceRef.current = nextSource
        pendingTimeRef.current = Math.max(0, options.startTime ?? 0)
        setSource(nextSource)
        setCurrentTime(pendingTimeRef.current)
        setDuration(0)
        setError(null)
        setIsLoading(true)
        audio.src = url
        audio.load()
      } else if (current !== nextSource) {
        sourceRef.current = nextSource
        setSource(nextSource)
      }

      if (options.autoplay) await play()
    },
    [play, releaseSourceUrl],
  )

  const toggleSource = React.useCallback(
    async (
      nextSource: AudioPlaybackSource,
      options: Omit<ActivateAudioSourceOptions, "autoplay"> = {},
    ) => {
      const audio = audioRef.current
      if (!audio) return
      if (sourceRef.current?.key !== nextSource.key || options.force) {
        await activateSource(nextSource, { ...options, autoplay: true })
        return
      }
      if (audio.paused) await play()
      else audio.pause()
    },
    [activateSource, play],
  )

  const seek = React.useCallback((time: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(time)) return
    const upperBound = Number.isFinite(audio.duration) ? audio.duration : Math.max(0, time)
    audio.currentTime = Math.min(upperBound, Math.max(0, time))
    setCurrentTime(audio.currentTime)
  }, [])

  const setVolume = React.useCallback((nextVolume: number) => {
    const normalized = clampVolume(nextVolume)
    if (audioRef.current) audioRef.current.volume = normalized
    setVolumeState(normalized)
  }, [])

  const clearSource = React.useCallback(
    (sourceKey?: string) => {
      const audio = audioRef.current
      if (!audio || (sourceKey && sourceRef.current?.key !== sourceKey)) return
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
      releaseSourceUrl()
      sourceRef.current = null
      pendingTimeRef.current = null
      setSource(null)
      setIsPlaying(false)
      setIsLoading(false)
      setCurrentTime(0)
      setDuration(0)
      setError(null)
    },
    [releaseSourceUrl],
  )

  const consumeEnded = React.useCallback((revision: number) => {
    if (revision <= consumedEndedRevisionRef.current) return false
    consumedEndedRevisionRef.current = revision
    return true
  }, [])

  const consumeMetadata = React.useCallback((revision: number) => {
    if (revision <= consumedMetadataRevisionRef.current) return false
    consumedMetadataRevisionRef.current = revision
    return true
  }, [])

  React.useEffect(
    () => () => {
      audioRef.current?.pause()
      releaseSourceUrl()
    },
    [releaseSourceUrl],
  )

  const controller = React.useMemo<AudioPlaybackController>(
    () => ({
      source,
      isPlaying,
      isLoading,
      currentTime,
      duration,
      volume,
      repeat,
      shuffle,
      error,
      endedRevision,
      metadataRevision,
      activateSource,
      toggleSource,
      play,
      pause,
      seek,
      setVolume,
      setRepeat,
      setShuffle,
      clearSource,
      consumeEnded,
      consumeMetadata,
    }),
    [
      source,
      isPlaying,
      isLoading,
      currentTime,
      duration,
      volume,
      repeat,
      shuffle,
      error,
      endedRevision,
      metadataRevision,
      activateSource,
      toggleSource,
      play,
      pause,
      seek,
      setVolume,
      setRepeat,
      setShuffle,
      clearSource,
      consumeEnded,
      consumeMetadata,
    ],
  )

  return (
    <AudioPlaybackContext.Provider value={controller}>
      {children}
      <audio
        ref={audioRef}
        className="hidden"
        aria-hidden="true"
        preload="metadata"
        onLoadStart={() => setIsLoading(true)}
        onCanPlay={() => setIsLoading(false)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget
          const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0
          if (pendingTimeRef.current !== null) {
            audio.currentTime = Math.min(
              pendingTimeRef.current,
              nextDuration || pendingTimeRef.current,
            )
            pendingTimeRef.current = null
          }
          setCurrentTime(audio.currentTime)
          setDuration(nextDuration)
          setIsLoading(false)
          setMetadataRevision((revision) => revision + 1)
        }}
        onDurationChange={(event) => {
          const nextDuration = event.currentTarget.duration
          if (Number.isFinite(nextDuration)) setDuration(nextDuration)
        }}
        onEnded={(event) => {
          setIsPlaying(false)
          setCurrentTime(event.currentTarget.currentTime)
          setEndedRevision((revision) => revision + 1)
        }}
        onError={(event) => {
          setIsPlaying(false)
          setIsLoading(false)
          setError(mediaErrorMessage(event.currentTarget.error))
        }}
      />
    </AudioPlaybackContext.Provider>
  )
}

export function useAudioPlayback(): AudioPlaybackController {
  const controller = React.useContext(AudioPlaybackContext)
  if (!controller) {
    throw new Error("useAudioPlayback must be used within AudioPlaybackProvider")
  }
  return controller
}
