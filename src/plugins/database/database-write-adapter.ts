import type { FileRef } from "@protocol/file-system"
import { DATABASE_ROOT_REF } from "@/filesystem/builtin-app-roots"
import { withFileWriteLock } from "@/filesystem/write-lock"
import { createPluginMutationInvalidationChannel } from "@/plugins/shared/plugin-mutation-channel"
import { importDatabaseJson } from "./database-store"

type DatabaseImporter = (raw: string) => Promise<{ tables: number; rows: number }>
type FileWriteLock = <T>(ref: FileRef, operation: () => T | Promise<T>) => Promise<T>

const databaseImportInvalidations = createPluginMutationInvalidationChannel(
  DATABASE_ROOT_REF.fileSystemId,
)

export const subscribeDatabaseImportInvalidation = databaseImportInvalidations.subscribe

/** Database 的跨入口 mutation 屏障；provider 与 data port 必须共享同一根锁。 */
export function withDatabaseRootMutationLock<T>(
  operation: () => T | Promise<T>,
  lock: FileWriteLock = withFileWriteLock,
): Promise<T> {
  return lock(DATABASE_ROOT_REF, operation)
}

/** Manifest 整库替换入口；store 原语保持不依赖 FileSystem。 */
export async function importDatabaseJsonWithRootLock(
  raw: string,
  importer: DatabaseImporter = importDatabaseJson,
): Promise<{ tables: number; rows: number }> {
  const result = await withDatabaseRootMutationLock(() => importer(raw))
  databaseImportInvalidations.publish()
  return result
}
