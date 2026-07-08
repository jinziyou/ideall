// 音频播放器 —— 播放列表本地存储。音频 Blob 直接存 IndexedDB, 不进入统一 Node 库。
import {
  createPluginDataPackage,
  parseExpectedPluginDataPackage,
  stringifyPluginDataPackage,
  type PluginDataPackage,
} from "@/plugins/shared/plugin-data"
import { createPluginDb } from "@/plugins/shared/plugin-idb"
import { base64ToBytes, bytesToBase64 } from "@/lib/base64"

export const AUDIO_DB_NAME = "ideall:audio"
export const AUDIO_DB_VERSION = 1
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

export const AUDIO_PLUGIN_ID = "audio"
export const AUDIO_PLUGIN_LABEL = "音频播放器"
export const AUDIO_EXPORT_KIND = "ideall.audio.library"
export const AUDIO_EXPORT_VERSION = 1
export const AUDIO_DATA_SPEC = {
  pluginId: AUDIO_PLUGIN_ID,
  pluginLabel: AUDIO_PLUGIN_LABEL,
  dataKind: AUDIO_EXPORT_KIND,
  dataVersion: AUDIO_EXPORT_VERSION,
} as const

export type AudioTrackExport = Omit<AudioTrack, "blob"> & {
  dataBase64: string
}

export type AudioLibraryPayload = {
  playback: AudioPlaybackState
  tracks: AudioTrackExport[]
}

export type AudioLibraryExport = PluginDataPackage<
  AudioLibraryPayload,
  typeof AUDIO_EXPORT_KIND,
  typeof AUDIO_EXPORT_VERSION
>

export const DEFAULT_AUDIO_PLAYBACK_STATE: AudioPlaybackState = {
  currentTrackId: null,
  currentTime: 0,
  volume: 0.8,
  repeat: "none",
  shuffle: false,
}

const audioDb = createPluginDb({
  name: AUDIO_DB_NAME,
  version: AUDIO_DB_VERSION,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} 格式无效`)
  return value
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 格式无效`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
}

function normalizeTrackExport(value: unknown): AudioTrackExport {
  if (!isRecord(value)) throw new Error("音频条目格式无效")
  return {
    id: requireString(value.id, "音频 id"),
    title: requireString(value.title, "音频标题"),
    artist: optionalString(value.artist),
    album: optionalString(value.album),
    mime: requireString(value.mime, "音频 MIME"),
    size: requireNumber(value.size, "音频 size"),
    duration: optionalNumber(value.duration),
    createdAt: requireNumber(value.createdAt, "音频 createdAt"),
    updatedAt: requireNumber(value.updatedAt, "音频 updatedAt"),
    dataBase64: requireString(value.dataBase64, "音频 dataBase64"),
  }
}

export async function audioTrackToExport(track: AudioTrack): Promise<AudioTrackExport> {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    mime: track.mime,
    size: track.size,
    duration: track.duration,
    createdAt: track.createdAt,
    updatedAt: track.updatedAt,
    dataBase64: await blobToBase64(track.blob),
  }
}

export function audioTrackFromExport(track: AudioTrackExport): AudioTrack {
  const bytes = base64ToBytes(track.dataBase64)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const blob = new Blob([buffer], { type: track.mime })
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    mime: track.mime,
    size: track.size,
    duration: track.duration,
    blob,
    createdAt: track.createdAt,
    updatedAt: track.updatedAt,
  }
}

export function createAudioLibraryExport(
  tracks: AudioTrackExport[],
  playback: AudioPlaybackState,
  exportedAt = new Date().toISOString(),
): AudioLibraryExport {
  return createPluginDataPackage(
    AUDIO_DATA_SPEC,
    {
      playback: normalizeAudioPlaybackState(playback),
      tracks,
    },
    exportedAt,
  )
}

export function parseAudioLibraryExport(raw: string): AudioLibraryExport {
  const pack = parseExpectedPluginDataPackage(raw, AUDIO_DATA_SPEC)
  if (!isRecord(pack.payload)) throw new Error("音频 JSON 缺少 payload")
  if (!Array.isArray(pack.payload.tracks)) throw new Error("音频 JSON 缺少 tracks")
  return createAudioLibraryExport(
    pack.payload.tracks.map(normalizeTrackExport),
    normalizeAudioPlaybackState(pack.payload.playback),
    pack.exportedAt,
  )
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

export async function exportAudioLibraryJson(): Promise<string> {
  const [tracks, playback] = await Promise.all([listAudioTracks(), loadAudioPlaybackState()])
  const payload = createAudioLibraryExport(
    await Promise.all(tracks.map((track) => audioTrackToExport(track))),
    playback,
  )
  return stringifyPluginDataPackage(payload)
}

export async function importAudioLibraryJson(raw: string): Promise<{ tracks: number }> {
  const backup = parseAudioLibraryExport(raw)
  const tracks = backup.payload.tracks.map(audioTrackFromExport)
  const db = await audioDb.open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_TRACKS, STORE_STATE], "readwrite")
    const trackStore = tx.objectStore(STORE_TRACKS)
    const stateStore = tx.objectStore(STORE_STATE)
    trackStore.clear()
    for (const track of tracks) trackStore.put(track)
    stateStore.put({ ...backup.payload.playback, key: "playback" })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  return { tracks: tracks.length }
}

export async function inspectAudioLibraryData(): Promise<{
  tracks: number
  bytes: number
  updatedAt: number | null
}> {
  const tracks = await listAudioTracks()
  return {
    tracks: tracks.length,
    bytes: tracks.reduce((sum, track) => sum + track.size, 0),
    updatedAt: tracks.reduce<number | null>(
      (latest, track) => (latest === null ? track.updatedAt : Math.max(latest, track.updatedAt)),
      null,
    ),
  }
}
