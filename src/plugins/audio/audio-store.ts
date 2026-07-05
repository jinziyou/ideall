// 音频播放器 —— 播放列表本地存储。音频 Blob 直接存 IndexedDB, 不进入统一 Node 库。
import { createPluginDb } from "@/plugins/shared/plugin-idb"

const DB_NAME = "ideall:audio"
const DB_VERSION = 1
const STORE_TRACKS = "tracks"
const STORE_STATE = "state"
const AUDIO_EXTS = new Set(["mp3", "flac", "wav", "ogg", "m4a", "aac", "wma", "opus"])

export type AudioTrack = {
  id: string
  title: string
  artist?: string
  album?: string
  mime: string
  size: number
  duration?: number
  blob: Blob
  createdAt: number
  updatedAt: number
}

export type AudioPlaybackState = {
  currentTrackId: string | null
  currentTime: number
  volume: number
  repeat: "none" | "one" | "all"
  shuffle: boolean
}

export const DEFAULT_AUDIO_PLAYBACK_STATE: AudioPlaybackState = {
  currentTrackId: null,
  currentTime: 0,
  volume: 0.8,
  repeat: "none",
  shuffle: false,
}

const audioDb = createPluginDb({
  name: DB_NAME,
  version: DB_VERSION,
  upgrade: (db) => {
    if (!db.objectStoreNames.contains(STORE_TRACKS)) {
      db.createObjectStore(STORE_TRACKS, { keyPath: "id" })
    }
    if (!db.objectStoreNames.contains(STORE_STATE)) {
      db.createObjectStore(STORE_STATE, { keyPath: "key" })
    }
  },
})

function makeId(): string {
  return `audio:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export function audioTitleFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name
}

export function isSupportedAudioFile(file: Pick<File, "name" | "type">): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  return file.type.startsWith("audio/") || AUDIO_EXTS.has(ext)
}

export function normalizeAudioPlaybackState(value: unknown): AudioPlaybackState {
  const saved = value && typeof value === "object" ? (value as Partial<AudioPlaybackState>) : {}
  const repeat = saved.repeat
  return {
    currentTrackId: typeof saved.currentTrackId === "string" ? saved.currentTrackId : null,
    currentTime:
      typeof saved.currentTime === "number" && Number.isFinite(saved.currentTime)
        ? Math.max(0, saved.currentTime)
        : DEFAULT_AUDIO_PLAYBACK_STATE.currentTime,
    volume:
      typeof saved.volume === "number" && Number.isFinite(saved.volume)
        ? Math.min(1, Math.max(0, saved.volume))
        : DEFAULT_AUDIO_PLAYBACK_STATE.volume,
    repeat: repeat === "one" || repeat === "all" || repeat === "none" ? repeat : "none",
    shuffle: typeof saved.shuffle === "boolean" ? saved.shuffle : false,
  }
}

export async function listAudioTracks(): Promise<AudioTrack[]> {
  const tracks = await audioDb.getAll<AudioTrack>(STORE_TRACKS)
  return tracks.sort((a, b) => a.createdAt - b.createdAt)
}

export async function addAudioTrack(file: File): Promise<AudioTrack> {
  const now = Date.now()
  const track: AudioTrack = {
    id: makeId(),
    title: audioTitleFromName(file.name),
    mime: file.type || "audio/*",
    size: file.size,
    blob: file,
    createdAt: now,
    updatedAt: now,
  }
  await audioDb.put(STORE_TRACKS, track)
  return track
}

export async function updateAudioTrack(
  id: string,
  patch: Partial<Pick<AudioTrack, "title" | "artist" | "album" | "duration">>,
): Promise<AudioTrack | null> {
  const current = await audioDb.get<AudioTrack>(STORE_TRACKS, id)
  if (!current) return null
  const next = { ...current, ...patch, updatedAt: Date.now() }
  await audioDb.put(STORE_TRACKS, next)
  return next
}

export async function removeAudioTrack(id: string): Promise<void> {
  await audioDb.remove(STORE_TRACKS, id)
}

export async function clearAudioTracks(): Promise<void> {
  await audioDb.clear(STORE_TRACKS)
}

export async function loadAudioPlaybackState(): Promise<AudioPlaybackState> {
  const saved = await audioDb.get<AudioPlaybackState & { key: string }>(STORE_STATE, "playback")
  if (!saved) return DEFAULT_AUDIO_PLAYBACK_STATE
  const { key: _key, ...state } = saved
  return normalizeAudioPlaybackState(state)
}

export async function saveAudioPlaybackState(state: AudioPlaybackState): Promise<void> {
  await audioDb.put(STORE_STATE, { ...normalizeAudioPlaybackState(state), key: "playback" })
}
