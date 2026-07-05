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

export const AUDIO_EXPORT_KIND = "ideall.audio"
export const AUDIO_EXPORT_VERSION = 1

export type AudioTrackExport = Omit<AudioTrack, "blob"> & {
  dataBase64: string
}

export type AudioLibraryExport = {
  kind: typeof AUDIO_EXPORT_KIND
  version: typeof AUDIO_EXPORT_VERSION
  exportedAt: string
  playback: AudioPlaybackState
  tracks: AudioTrackExport[]
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

type BufferLike = {
  from: (
    input: Uint8Array | string,
    encoding?: string,
  ) => { toString: (encoding: string) => string }
}

function bytesToBase64(bytes: Uint8Array): string {
  const maybeBuffer = (globalThis as unknown as { Buffer?: BufferLike }).Buffer
  if (maybeBuffer) return maybeBuffer.from(bytes).toString("base64")
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const maybeBuffer = (globalThis as unknown as { Buffer?: BufferLike }).Buffer
  if (maybeBuffer) {
    const binary = maybeBuffer.from(value, "base64").toString("binary")
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  }
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
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
  return {
    kind: AUDIO_EXPORT_KIND,
    version: AUDIO_EXPORT_VERSION,
    exportedAt,
    playback: normalizeAudioPlaybackState(playback),
    tracks,
  }
}

export function parseAudioLibraryExport(raw: string): AudioLibraryExport {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) throw new Error("音频 JSON 格式无效")
  if (parsed.kind !== AUDIO_EXPORT_KIND || parsed.version !== AUDIO_EXPORT_VERSION) {
    throw new Error("不支持的音频 JSON 版本")
  }
  if (!Array.isArray(parsed.tracks)) throw new Error("音频 JSON 缺少 tracks")
  return createAudioLibraryExport(
    parsed.tracks.map(normalizeTrackExport),
    normalizeAudioPlaybackState(parsed.playback),
    requireString(parsed.exportedAt, "exportedAt"),
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
  return JSON.stringify(payload, null, 2)
}

export async function importAudioLibraryJson(raw: string): Promise<{ tracks: number }> {
  const backup = parseAudioLibraryExport(raw)
  const tracks = backup.tracks.map(audioTrackFromExport)
  const db = await audioDb.open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_TRACKS, STORE_STATE], "readwrite")
    const trackStore = tx.objectStore(STORE_TRACKS)
    const stateStore = tx.objectStore(STORE_STATE)
    trackStore.clear()
    for (const track of tracks) trackStore.put(track)
    stateStore.put({ ...backup.playback, key: "playback" })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  return { tracks: tracks.length }
}
