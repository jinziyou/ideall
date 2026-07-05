import { isTauri } from "@/lib/tauri"
import { safeStoragePreview } from "./debug-redact"

export type StorageEntry = {
  key: string
  bytes: number
  preview: string
  redacted: boolean
  error?: string
}

export type StorageBucket = {
  entries: StorageEntry[]
  error?: string
}

export type DebugSnapshot = {
  generatedAt: string
  runtime: {
    href: string
    userAgent: string
    language: string
    online: boolean
    timezone: string
    viewport: string
    tauri: boolean
  }
  storage: {
    localStorage: StorageBucket
    sessionStorage: StorageBucket
  }
  workspace?: {
    source: "localStorage" | "sessionStorage"
    tabs: number
    activeId: string | null
    activeModule: string | null
    mode: string | null
  }
}

export type StorageLike = Pick<Storage, "length" | "key" | "getItem">

export type DebugSnapshotInput = {
  localStorage?: StorageLike
  sessionStorage?: StorageLike
  runtime: DebugSnapshot["runtime"]
}

export const WORKSPACE_KEY = "ideall:workspace:v1"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function readStorage(storage: StorageLike | undefined, label: string): StorageBucket {
  if (!storage) return { entries: [], error: `${label} 不可用` }
  let length = 0
  try {
    length = storage.length
  } catch (error) {
    return { entries: [], error: errorMessage(error) }
  }

  const entries: StorageEntry[] = []
  for (let i = 0; i < length; i += 1) {
    let key: string | null = null
    try {
      key = storage.key(i)
    } catch (error) {
      entries.push({
        key: `<读取 key ${i} 失败>`,
        bytes: 0,
        preview: errorMessage(error),
        redacted: false,
        error: errorMessage(error),
      })
      continue
    }
    if (!key) continue
    try {
      const value = storage.getItem(key) ?? ""
      const preview = safeStoragePreview(key, value)
      entries.push({
        key,
        bytes: byteLength(value),
        preview: preview.value,
        redacted: preview.redacted,
      })
    } catch (error) {
      entries.push({
        key,
        bytes: 0,
        preview: `读取失败: ${errorMessage(error)}`,
        redacted: false,
        error: errorMessage(error),
      })
    }
  }
  return { entries: entries.sort((a, b) => a.key.localeCompare(b.key)) }
}

export function readWorkspace(
  raw: string | null,
  source: "localStorage" | "sessionStorage",
): DebugSnapshot["workspace"] | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as {
      tabs?: unknown[]
      activeId?: unknown
      activeModule?: unknown
      mode?: unknown
    }
    return {
      source,
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs.length : 0,
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
      activeModule: typeof parsed.activeModule === "string" ? parsed.activeModule : null,
      mode: typeof parsed.mode === "string" ? parsed.mode : null,
    }
  } catch {
    return {
      source,
      tabs: 0,
      activeId: null,
      activeModule: "parse-error",
      mode: null,
    }
  }
}

export function readDebugSnapshot(input: DebugSnapshotInput): DebugSnapshot {
  const localStorage = readStorage(input.localStorage, "localStorage")
  const sessionStorage = readStorage(input.sessionStorage, "sessionStorage")

  return {
    generatedAt: new Date().toISOString(),
    runtime: input.runtime,
    storage: {
      localStorage,
      sessionStorage,
    },
    workspace:
      readWorkspace(storageGetItem(input.sessionStorage, WORKSPACE_KEY), "sessionStorage") ??
      readWorkspace(storageGetItem(input.localStorage, WORKSPACE_KEY), "localStorage"),
  }
}

export function readBrowserDebugSnapshot(): DebugSnapshot {
  return readDebugSnapshot({
    localStorage: safeBrowserStorage("localStorage"),
    sessionStorage: safeBrowserStorage("sessionStorage"),
    runtime: {
      href: window.location.href,
      userAgent: navigator.userAgent,
      language: navigator.language,
      online: navigator.onLine,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      tauri: isTauri(),
    },
  })
}

function safeBrowserStorage(name: "localStorage" | "sessionStorage"): StorageLike | undefined {
  try {
    return window[name]
  } catch {
    return undefined
  }
}

function storageGetItem(storage: StorageLike | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}
