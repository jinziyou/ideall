import { fileRefKey, parseFileRefKey, type FileRef } from "@protocol/file-system"
import { panelFileRef } from "@/filesystem/resource-file-system"
import { STARTUP_TARGET_STORAGE_KEY } from "@/lib/workspace-storage"

export { STARTUP_TARGET_STORAGE_KEY }

export type StartupTarget = {
  ref: FileRef
  engineId: string
  rootId?: string
}

export const DEFAULT_STARTUP_TARGET: StartupTarget = {
  ref: panelFileRef("home"),
  engineId: "ideall.panel",
  rootId: "home",
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

export function parseStartupTarget(raw: string | null | undefined): StartupTarget | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as { file?: unknown; engineId?: unknown; rootId?: unknown }
    const ref = typeof value.file === "string" ? parseFileRefKey(value.file) : null
    const engineId = typeof value.engineId === "string" ? value.engineId.trim() : ""
    const rootId = typeof value.rootId === "string" && value.rootId ? value.rootId : undefined
    return ref && engineId ? { ref, engineId, rootId } : null
  } catch {
    return null
  }
}

export function readStartupTarget(storage?: Pick<Storage, "getItem"> | null): StartupTarget {
  if (!storage) return DEFAULT_STARTUP_TARGET
  try {
    return parseStartupTarget(storage.getItem(STARTUP_TARGET_STORAGE_KEY)) ?? DEFAULT_STARTUP_TARGET
  } catch {
    return DEFAULT_STARTUP_TARGET
  }
}

export function writeStartupTarget(storage: StorageLike | null | undefined, target: StartupTarget) {
  if (!storage) return false
  try {
    storage.setItem(
      STARTUP_TARGET_STORAGE_KEY,
      JSON.stringify({
        file: fileRefKey(target.ref),
        engineId: target.engineId,
        rootId: target.rootId,
      }),
    )
    return true
  } catch {
    return false
  }
}

export function resetStartupTarget(storage: StorageLike | null | undefined) {
  if (!storage) return false
  try {
    storage.removeItem(STARTUP_TARGET_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
