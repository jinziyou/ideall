import { isTauri } from "@/lib/tauri"

export type GuardedFsEntry = {
  name: string
  relativePath: string
  stableId: string
  kind: "file" | "directory"
  size: number
  modifiedAt: number | null
  version: string
}

export type GuardedFsGrant = {
  grantId: string
  path: string
  name: string
}

export type GuardedFsReadResult = {
  base64: string
  size: number
  version: string
}

async function invokeGuarded<T>(command: string, input: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("受限本地文件系统仅在桌面 App 中可用")
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, input)
}

export function guardedFsPickRoot(): Promise<GuardedFsGrant | null> {
  return invokeGuarded("guarded_fs_pick_root", {})
}

export function guardedFsGrantInfo(grantId: string): Promise<GuardedFsGrant> {
  return invokeGuarded("guarded_fs_grant_info", { grantId })
}

export function guardedFsRevokeGrant(grantId: string): Promise<boolean> {
  return invokeGuarded("guarded_fs_revoke_grant", { grantId })
}

export function guardedFsStat(grantId: string, entryId?: string): Promise<GuardedFsEntry | null> {
  return invokeGuarded("guarded_fs_stat", { grantId, entryId })
}

export function guardedFsList(grantId: string, entryId?: string): Promise<GuardedFsEntry[]> {
  return invokeGuarded("guarded_fs_list", { grantId, entryId })
}

export function guardedFsRead(
  grantId: string,
  entryId: string,
  range?: { start: number; end?: number },
): Promise<GuardedFsReadResult> {
  return invokeGuarded("guarded_fs_read", {
    grantId,
    entryId,
    start: range?.start,
    end: range?.end,
  })
}

export function guardedFsWriteText(
  grantId: string,
  entryId: string,
  content: string,
  expectedVersion?: string,
): Promise<GuardedFsEntry> {
  return invokeGuarded("guarded_fs_write_text", {
    grantId,
    entryId,
    content,
    expectedVersion,
  })
}
