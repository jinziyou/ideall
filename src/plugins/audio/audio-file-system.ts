import { fileRefKey, sameFileRef, type FileRef, type IdeallFile } from "@protocol/file-system"
import type {
  DirectoryPage,
  FileAction,
  FileReadOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchHandle,
  FileWriteInput,
} from "@/filesystem/types"
import { FileSystemError } from "@/filesystem/types"
import { FileSystemWatchEventHub } from "@/filesystem/watch-set"
import { withFileWriteLock } from "@/filesystem/write-lock"
import {
  AUDIO_FILE_SYSTEM_ID as BUILTIN_AUDIO_FILE_SYSTEM_ID,
  AUDIO_LIBRARY_ROOT_REF,
} from "@/filesystem/builtin-app-roots"
import {
  addAudioTrack,
  exportAudioLibraryJson,
  importAudioLibraryJson,
  listAudioTracks,
  loadAudioPlaybackState,
  removeAudioTrack,
  saveAudioPlaybackState,
  updateAudioTrack,
  type AudioPlaybackState,
  type AudioTrack,
} from "./audio-store"

export const AUDIO_FILE_SYSTEM_ID = BUILTIN_AUDIO_FILE_SYSTEM_ID
export const audioLibraryRootRef: FileRef = AUDIO_LIBRARY_ROOT_REF

export function audioTrackRef(id: string): FileRef {
  return { fileSystemId: AUDIO_FILE_SYSTEM_ID, fileId: `track:${encodeURIComponent(id)}` }
}

export function audioTrackIdFromRef(ref: FileRef): string | null {
  if (ref.fileSystemId !== AUDIO_FILE_SYSTEM_ID || !ref.fileId.startsWith("track:")) return null
  try {
    return decodeURIComponent(ref.fileId.slice("track:".length)) || null
  } catch {
    return null
  }
}

function trackFile(track: AudioTrack): IdeallFile {
  return {
    ref: audioTrackRef(track.id),
    kind: "file",
    name: track.title,
    mediaType: track.mime || "audio/*",
    capabilities: ["read", "write", "delete", "actions", "watch", "standalone-window"],
    source: { kind: "app", id: "audio", label: "音频库" },
    size: track.size,
    createdAt: track.createdAt,
    updatedAt: track.updatedAt,
    version: String(track.updatedAt),
    properties: {
      artist: track.artist ?? null,
      album: track.album ?? null,
      duration: track.duration ?? null,
    },
  }
}

export type AudioFileSystemDeps = {
  addTrack: typeof addAudioTrack
  exportLibrary: typeof exportAudioLibraryJson
  importLibrary: typeof importAudioLibraryJson
  listTracks: typeof listAudioTracks
  loadPlayback: typeof loadAudioPlaybackState
  removeTrack: typeof removeAudioTrack
  savePlayback: typeof saveAudioPlaybackState
  updateTrack: typeof updateAudioTrack
}

const defaultDeps: AudioFileSystemDeps = {
  addTrack: addAudioTrack,
  exportLibrary: exportAudioLibraryJson,
  importLibrary: importAudioLibraryJson,
  listTracks: listAudioTracks,
  loadPlayback: loadAudioPlaybackState,
  removeTrack: removeAudioTrack,
  savePlayback: saveAudioPlaybackState,
  updateTrack: updateAudioTrack,
}

async function findTrack(ref: FileRef, deps: AudioFileSystemDeps): Promise<AudioTrack | undefined> {
  const id = audioTrackIdFromRef(ref)
  return id ? (await deps.listTracks()).find((item) => item.id === id) : undefined
}

async function requireTrack(ref: FileRef, deps: AudioFileSystemDeps): Promise<AudioTrack> {
  const track = await findTrack(ref, deps)
  if (!track)
    throw new FileSystemError("not-found", `Audio file not found: ${fileRefKey(ref)}`, ref)
  return track
}

function assertAccess(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  intent: "metadata" | "directory" | "content" | "write" | "action" | "watch",
  permission: "fs:read" | "fs.blobs:read" | "fs:write",
  allowActiveEngine = true,
): void {
  if (ctx.actor === "ui") return
  if (
    allowActiveEngine &&
    ctx.actor === "engine" &&
    ctx.activeFile != null &&
    sameFileRef(ref, ctx.activeFile) &&
    ctx.intent === intent
  ) {
    return
  }
  if (ctx.intent === intent && ctx.permissions.includes(permission)) return
  throw new FileSystemError(
    "permission-denied",
    `The ${ctx.actor} actor requires ${permission} permission and ${intent} intent`,
    ref,
  )
}

function readRange(
  ref: FileRef,
  blob: Blob,
  range: FileReadOptions["range"],
): { blob: Blob; size: number } {
  if (!range) return { blob, size: blob.size }
  if (
    !Number.isSafeInteger(range.start) ||
    range.start < 0 ||
    (range.end != null && (!Number.isSafeInteger(range.end) || range.end < range.start))
  ) {
    throw new FileSystemError("invalid-input", "Invalid read range", ref)
  }
  const sliced = blob.slice(range.start, range.end, blob.type)
  return { blob: sliced, size: sliced.size }
}

function assertExpectedVersion(
  ref: FileRef,
  expectedVersion: string | null | undefined,
  currentVersion: string,
): void {
  if (expectedVersion === undefined || expectedVersion === currentVersion) return
  throw new FileSystemError(
    "conflict",
    `Audio file version changed (expected ${expectedVersion ?? "no version"}, current ${currentVersion})`,
    ref,
  )
}

export function createAudioFileSystem(
  overrides: Partial<AudioFileSystemDeps> = {},
): FileSystemProvider {
  const deps: AudioFileSystemDeps = { ...defaultDeps, ...overrides }
  const watchEvents = new FileSystemWatchEventHub()

  return {
    descriptor: {
      fileSystemId: AUDIO_FILE_SYSTEM_ID,
      name: "音频库",
      root: audioLibraryRootRef,
      source: { kind: "app", id: "audio", label: "音频库" },
      capabilities: ["read-directory", "read", "write", "create", "delete", "actions", "watch"],
    },
    async stat(ref, ctx) {
      assertAccess(ref, ctx, "metadata", "fs:read")
      if (sameFileRef(ref, audioLibraryRootRef)) {
        return {
          ref,
          kind: "directory",
          name: "音频库",
          mediaType: "application/vnd.ideall.audio.library+json",
          capabilities: ["read-directory", "read", "write", "create", "actions", "watch"],
          source: this.descriptor.source,
        }
      }
      const track = await findTrack(ref, deps)
      return track ? trackFile(track) : null
    },
    async readDirectory(ref, ctx): Promise<DirectoryPage> {
      assertAccess(ref, ctx, "directory", "fs:read")
      if (!sameFileRef(ref, audioLibraryRootRef)) {
        throw new FileSystemError("unsupported", "Audio files are not directories", ref)
      }
      const tracks = await deps.listTracks()
      return {
        entries: tracks.map((track, index) => ({
          entryId: track.id,
          parent: audioLibraryRootRef,
          target: audioTrackRef(track.id),
          name: track.title,
          kind: "child",
          sortKey: String(index).padStart(6, "0"),
        })),
      }
    },
    async read(ref, ctx, options?: FileReadOptions): Promise<FileReadResult> {
      if (sameFileRef(ref, audioLibraryRootRef)) {
        assertAccess(ref, ctx, "content", "fs:read")
        return {
          data: await deps.loadPlayback(),
          mediaType: "application/vnd.ideall.audio.playback+json",
        }
      }
      assertAccess(ref, ctx, "content", "fs.blobs:read")
      const track = await requireTrack(ref, deps)
      const ranged = readRange(ref, track.blob, options?.range)
      return {
        data: ranged.blob,
        mediaType: track.mime,
        size: ranged.size,
        version: String(track.updatedAt),
      }
    },
    async write(ref, input: FileWriteInput, ctx): Promise<IdeallFile> {
      assertAccess(ref, ctx, "write", "fs:write")
      return withFileWriteLock(ref, async () => {
        if (sameFileRef(ref, audioLibraryRootRef)) {
          if (!input.data || typeof input.data !== "object") {
            throw new FileSystemError(
              "invalid-input",
              "Audio playback state must be an object",
              ref,
            )
          }
          await deps.savePlayback(input.data as AudioPlaybackState)
          watchEvents.emit({ type: "changed", ref })
          return {
            ref,
            kind: "directory",
            name: "音频库",
            mediaType: "application/vnd.ideall.audio.library+json",
            capabilities: ["read-directory", "read", "write", "create", "actions", "watch"],
            source: this.descriptor.source,
          }
        }
        const track = await requireTrack(ref, deps)
        assertExpectedVersion(ref, input.expectedVersion, String(track.updatedAt))
        if (!input.data || typeof input.data !== "object") {
          throw new FileSystemError("invalid-input", "Audio metadata patch must be an object", ref)
        }
        const patch = input.data as Partial<
          Pick<AudioTrack, "title" | "artist" | "album" | "duration">
        >
        const updated = await deps.updateTrack(track.id, patch)
        if (!updated) throw new FileSystemError("not-found", "Audio file disappeared", ref)
        const file = trackFile(updated)
        watchEvents.emit({
          type: "changed",
          ref: file.ref,
          entryId: updated.id,
          newParent: audioLibraryRootRef,
          version: String(updated.updatedAt),
        })
        return file
      })
    },
    async actions(ref, ctx): Promise<FileAction[]> {
      assertAccess(ref, ctx, "action", "fs:read")
      if (sameFileRef(ref, audioLibraryRootRef)) {
        return [
          { id: "open", label: "打开", kind: "display" },
          {
            id: "add-track",
            label: "添加音频",
            kind: "invoke",
            input: { type: "string", title: "音频文件", format: "binary" },
            idempotent: false,
            requires: ["create"],
          },
          {
            id: "import",
            label: "导入音频库",
            kind: "invoke",
            risk: "caution",
            input: {
              type: "string",
              title: "音频库 JSON",
              format: "multiline",
              minLength: 2,
            },
            uiHints: {
              confirmDescription: "导入会合并并更新当前音频库。",
            },
            requires: ["write"],
          },
          {
            id: "export",
            label: "导出音频库",
            kind: "invoke",
            output: { type: "string", mediaType: "application/json" },
            idempotent: true,
            requires: ["read"],
          },
        ]
      }
      await requireTrack(ref, deps)
      return [
        { id: "open", label: "打开", kind: "display" },
        {
          id: "delete",
          label: "删除",
          kind: "invoke",
          risk: "destructive",
          idempotent: true,
          requires: ["delete"],
        },
      ]
    },
    async invoke(ref, action, input, ctx) {
      const writeAction = action === "delete" || action === "add-track" || action === "import"
      assertAccess(ref, ctx, "action", writeAction ? "fs:write" : "fs:read", !writeAction)
      if (action === "open") return { ref }
      if (action === "add-track" && sameFileRef(ref, audioLibraryRootRef)) {
        if (!(input instanceof Blob) || typeof (input as Partial<File>).name !== "string") {
          throw new FileSystemError("invalid-input", "add-track requires an audio File", ref)
        }
        const track = await deps.addTrack(input as File)
        watchEvents.emit({
          type: "created",
          ref: audioTrackRef(track.id),
          entryId: track.id,
          newParent: audioLibraryRootRef,
          version: String(track.updatedAt),
        })
        return trackFile(track)
      }
      if (action === "import" && sameFileRef(ref, audioLibraryRootRef)) {
        if (typeof input !== "string") {
          throw new FileSystemError("invalid-input", "Audio import requires JSON text", ref)
        }
        const result = await deps.importLibrary(input)
        watchEvents.emit({ type: "changed", ref: audioLibraryRootRef })
        return result
      }
      if (action === "export" && sameFileRef(ref, audioLibraryRootRef)) {
        return deps.exportLibrary()
      }
      if (action === "delete") {
        const track = await requireTrack(ref, deps)
        await deps.removeTrack(track.id)
        watchEvents.emit({
          type: "deleted",
          ref,
          entryId: track.id,
          oldParent: audioLibraryRootRef,
        })
        return { ref, deleted: true }
      }
      throw new FileSystemError("unsupported", `Unsupported audio action: ${action}`, ref)
    },
    watch(ref, ctx, notify): FileSystemWatchHandle | null {
      assertAccess(ref, ctx, "watch", "fs:read")
      return watchEvents.watch(ref, notify)
    },
  }
}

export const audioFileSystem = createAudioFileSystem()

let mounted: (() => void) | null = null

export function registerAudioFileSystem(
  mount: (provider: FileSystemProvider) => () => void,
): () => void {
  if (mounted) return () => {}
  const dispose = mount(audioFileSystem)
  mounted = dispose
  return () => {
    if (mounted !== dispose) return
    mounted = null
    dispose()
  }
}
