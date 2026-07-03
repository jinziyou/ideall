// 音乐播放器 —— 播放列表本地存储 (独立 IndexedDB, 不进入统一 Node 库)。

const DB_NAME = "ideall:music"
const DB_VERSION = 1
const STORE_TRACKS = "tracks"
const STORE_STATE = "state"

export type Track = {
  id: string
  title: string
  artist?: string
  album?: string
  /** 文件路径或 blob URL / file:// URL */
  src: string
  duration?: number
  createdAt: number
}

export type PlaybackState = {
  currentTrackId: string | null
  currentTime: number
  volume: number
  repeat: "none" | "one" | "all"
  shuffle: boolean
}

const DEFAULT_STATE: PlaybackState = {
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
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
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

async function readStore<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly")
    const store = tx.objectStore(storeName)
    const req = store.get(key)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result as T | undefined)
  })
}

async function writeStore<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const store = tx.objectStore(storeName)
    const req = store.put(value)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
}

async function deleteStore(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const store = tx.objectStore(storeName)
    const req = store.delete(key)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly")
    const store = tx.objectStore(storeName)
    const req = store.getAll()
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve((req.result as T[]) ?? [])
  })
}

export async function listTracks(): Promise<Track[]> {
  const tracks = await getAll<Track>(STORE_TRACKS)
  return tracks.sort((a, b) => b.createdAt - a.createdAt)
}

export async function addTrack(track: Omit<Track, "id" | "createdAt">): Promise<Track> {
  const id = `track:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  const full: Track = { ...track, id, createdAt: Date.now() }
  await writeStore(STORE_TRACKS, full)
  return full
}

export async function removeTrack(id: string): Promise<void> {
  await deleteStore(STORE_TRACKS, id)
}

export async function loadPlaybackState(): Promise<PlaybackState> {
  const saved = await readStore<PlaybackState & { key: string }>(STORE_STATE, "playback")
  if (!saved) return DEFAULT_STATE
  const { key: _key, ...state } = saved
  return { ...DEFAULT_STATE, ...state }
}

export async function savePlaybackState(state: PlaybackState): Promise<void> {
  await writeStore(STORE_STATE, { ...state, key: "playback" })
}
