import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  sameFileRef,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type {
  DirectoryPage,
  FileAction,
  FileReadResult,
  FileSystemProvider,
  FileWriteInput,
} from "@/filesystem/types"
import { FileSystemError } from "@/filesystem/types"
import { listAudioTracks, removeAudioTrack, updateAudioTrack, type AudioTrack } from "./audio-store"

export const AUDIO_FILE_SYSTEM_ID = "app.audio-library"
const ROOT_REF: FileRef = { fileSystemId: AUDIO_FILE_SYSTEM_ID, fileId: "root" }

function trackRef(id: string): FileRef {
  return { fileSystemId: AUDIO_FILE_SYSTEM_ID, fileId: `track:${encodeURIComponent(id)}` }
}

function trackId(ref: FileRef): string | null {
  if (ref.fileSystemId !== AUDIO_FILE_SYSTEM_ID || !ref.fileId.startsWith("track:")) return null
  try {
    return decodeURIComponent(ref.fileId.slice("track:".length)) || null
  } catch {
    return null
  }
}

function trackFile(track: AudioTrack): IdeallFile {
  return {
    ref: trackRef(track.id),
    kind: "file",
    name: track.title,
    mediaType: track.mime || "audio/*",
    capabilities: ["read", "write", "delete", "actions"],
    source: { kind: "app", id: "audio", label: "音频库" },
    size: track.size,
    createdAt: track.createdAt,
    updatedAt: track.updatedAt,
    properties: { artist: track.artist ?? null, album: track.album ?? null, legacy: true },
  }
}

async function requireTrack(ref: FileRef): Promise<AudioTrack> {
  const id = trackId(ref)
  if (!id) throw new FileSystemError("not-found", `Audio file not found: ${fileRefKey(ref)}`, ref)
  const track = (await listAudioTracks()).find((item) => item.id === id)
  if (!track)
    throw new FileSystemError("not-found", `Audio file not found: ${fileRefKey(ref)}`, ref)
  return track
}

export const audioFileSystem: FileSystemProvider = {
  descriptor: {
    fileSystemId: AUDIO_FILE_SYSTEM_ID,
    name: "音频库",
    root: ROOT_REF,
    source: { kind: "app", id: "audio", label: "音频库" },
    capabilities: ["read-directory", "read", "write", "delete", "actions"],
  },
  async stat(ref) {
    if (sameFileRef(ref, ROOT_REF)) {
      return {
        ref,
        kind: "directory",
        name: "音频库",
        mediaType: DIRECTORY_MEDIA_TYPE,
        capabilities: ["read-directory", "actions"],
        source: this.descriptor.source,
        properties: { legacy: true },
      }
    }
    return trackFile(await requireTrack(ref))
  },
  async readDirectory(ref): Promise<DirectoryPage> {
    if (!sameFileRef(ref, ROOT_REF)) {
      throw new FileSystemError("unsupported", "Audio files are not directories", ref)
    }
    const tracks = await listAudioTracks()
    return {
      entries: tracks.map((track, index) => ({
        entryId: track.id,
        parent: ROOT_REF,
        target: trackRef(track.id),
        name: track.title,
        kind: "child",
        sortKey: String(index).padStart(6, "0"),
      })),
    }
  },
  async read(ref): Promise<FileReadResult> {
    const track = await requireTrack(ref)
    return {
      data: track.blob,
      mediaType: track.mime,
      size: track.size,
      version: String(track.updatedAt),
    }
  },
  async write(ref, input: FileWriteInput): Promise<IdeallFile> {
    const track = await requireTrack(ref)
    if (!input.data || typeof input.data !== "object") {
      throw new FileSystemError("invalid-input", "Audio metadata patch must be an object", ref)
    }
    const patch = input.data as Partial<Pick<AudioTrack, "title" | "artist" | "album" | "duration">>
    const updated = await updateAudioTrack(track.id, patch)
    if (!updated) throw new FileSystemError("not-found", "Audio file disappeared", ref)
    return trackFile(updated)
  },
  async actions(ref): Promise<FileAction[]> {
    if (sameFileRef(ref, ROOT_REF)) return [{ id: "open", label: "打开" }]
    await requireTrack(ref)
    return [
      { id: "open", label: "打开" },
      { id: "delete", label: "删除", destructive: true, requires: ["delete"] },
    ]
  },
  async invoke(ref, action) {
    if (action === "open") return { ref }
    if (action === "delete") {
      const track = await requireTrack(ref)
      await removeAudioTrack(track.id)
      return { ref, deleted: true }
    }
    throw new FileSystemError("unsupported", `Unsupported audio action: ${action}`, ref)
  },
}

let mounted = false

export function registerAudioFileSystem(mount: (provider: FileSystemProvider) => void): void {
  if (mounted) return
  mount(audioFileSystem)
  mounted = true
}
