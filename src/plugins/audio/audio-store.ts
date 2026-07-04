// 音频播放器 —— 播放列表本地存储。音频 Blob 直接存 IndexedDB, 不进入统一 Node 库。

const DB_NAME = "ideall:audio"
const DB_VERSION = 1
const STORE_TRACKS = "tracks"
const STORE_STATE = "state"

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

const DEFAULT_STATE: AudioPlaybackState = {
  currentTrackId: null,
  currentTime: 0,
  volume: 0.8,
  repeat: "none",
  shuffle: false,
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      dbPromise = null
      reject(new Error("当前环境不支持 IndexedDB"))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
    req.onblocked = () => {
      dbPromise = null
      reject(new Error("IndexedDB 升级被其它标签页阻塞"))
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        db.createObjectStore(STORE_TRACKS, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE, { keyPath: "key" })
      }
    }
  })
  return dbPromise
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb()
  const tx = db.transaction(storeName, "readonly")
  return requestToPromise<T[]>(tx.objectStore(storeName).getAll())
}

async function readStore<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb()
  const tx = db.transaction(storeName, "readonly")
  return requestToPromise<T | undefined>(tx.objectStore(storeName).get(key))
}

async function writeStore<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(storeName, "readwrite")
  await requestToPromise(tx.objectStore(storeName).put(value))
}

async function deleteStore(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(storeName, "readwrite")
  await requestToPromise(tx.objectStore(storeName).delete(key))
}

async function clearStore(storeName: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(storeName, "readwrite")
  await requestToPromise(tx.objectStore(storeName).clear())
}

function makeId(): string {
  return `audio:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

function titleFromFile(file: File): string {
  return file.name.replace(/\.[^.]+$/, "") || file.name
}

export async function listAudioTracks(): Promise<AudioTrack[]> {
  const tracks = await getAll<AudioTrack>(STORE_TRACKS)
  return tracks.sort((a, b) => a.createdAt - b.createdAt)
}

export async function addAudioTrack(file: File): Promise<AudioTrack> {
  const now = Date.now()
  const track: AudioTrack = {
    id: makeId(),
    title: titleFromFile(file),
    mime: file.type || "audio/*",
    size: file.size,
    blob: file,
    createdAt: now,
    updatedAt: now,
  }
  await writeStore(STORE_TRACKS, track)
  return track
}

export async function updateAudioTrack(
  id: string,
  patch: Partial<Pick<AudioTrack, "title" | "artist" | "album" | "duration">>,
): Promise<AudioTrack | null> {
  const current = await readStore<AudioTrack>(STORE_TRACKS, id)
  if (!current) return null
  const next = { ...current, ...patch, updatedAt: Date.now() }
  await writeStore(STORE_TRACKS, next)
  return next
}

export async function removeAudioTrack(id: string): Promise<void> {
  await deleteStore(STORE_TRACKS, id)
}

export async function clearAudioTracks(): Promise<void> {
  await clearStore(STORE_TRACKS)
}

export async function loadAudioPlaybackState(): Promise<AudioPlaybackState> {
  const saved = await readStore<AudioPlaybackState & { key: string }>(STORE_STATE, "playback")
  if (!saved) return DEFAULT_STATE
  const { key: _key, ...state } = saved
  return { ...DEFAULT_STATE, ...state }
}

export async function saveAudioPlaybackState(state: AudioPlaybackState): Promise<void> {
  await writeStore(STORE_STATE, { ...state, key: "playback" })
}
