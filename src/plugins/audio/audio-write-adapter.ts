import type { FileRef } from "@protocol/file-system"
import { AUDIO_LIBRARY_ROOT_REF } from "@/filesystem/builtin-app-roots"
import { withFileWriteLock } from "@/filesystem/write-lock"
import { createPluginMutationInvalidationChannel } from "@/plugins/shared/plugin-mutation-channel"
import { importAudioLibraryJson } from "./audio-store"

type AudioLibraryImporter = (raw: string) => Promise<{ tracks: number }>
type FileWriteLock = <T>(ref: FileRef, operation: () => T | Promise<T>) => Promise<T>

const audioImportInvalidations = createPluginMutationInvalidationChannel(
  AUDIO_LIBRARY_ROOT_REF.fileSystemId,
)

export const subscribeAudioImportInvalidation = audioImportInvalidations.subscribe

/** Audio 的跨入口 mutation 屏障；provider 与 data port 必须共享同一音频库根锁。 */
export function withAudioLibraryRootMutationLock<T>(
  operation: () => T | Promise<T>,
  lock: FileWriteLock = withFileWriteLock,
): Promise<T> {
  return lock(AUDIO_LIBRARY_ROOT_REF, operation)
}

/** Manifest 整库替换入口；store 原语保持不依赖 FileSystem。 */
export async function importAudioLibraryJsonWithRootLock(
  raw: string,
  importer: AudioLibraryImporter = importAudioLibraryJson,
): Promise<{ tracks: number }> {
  const result = await withAudioLibraryRootMutationLock(() => importer(raw))
  audioImportInvalidations.publish()
  return result
}
