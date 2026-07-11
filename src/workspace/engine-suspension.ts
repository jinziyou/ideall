/**
 * Engine 休眠快照只保存在当前窗口 sessionStorage；它不是文件内容的第二份长期存储。
 * Renderer 必须先成功写入快照并把 tab 标记为 suspend-ready，TabHost 才会卸载 dirty Engine。
 */

const SNAPSHOT_PREFIX = "ideall:engine-suspend:v1:"
export const MAX_ENGINE_SUSPEND_SNAPSHOT_BYTES = 1024 * 1024
export const MAX_ENGINE_SUSPEND_TOTAL_BYTES = 4 * 1024 * 1024
export const MAX_ENGINE_SUSPEND_SNAPSHOTS = 24

type EngineSuspendEnvelope = {
  version: 1
  tabId: string
  engineId: string
  fileKey: string
  updatedAt: number
  payload: unknown
}

function snapshotKey(tabId: string): string {
  return `${SNAPSHOT_PREFIX}${encodeURIComponent(tabId)}`
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function snapshotEntries(storage: Storage): Array<{ key: string; bytes: number }> {
  const entries: Array<{ key: string; bytes: number }> = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(SNAPSHOT_PREFIX)) continue
    const value = storage.getItem(key)
    entries.push({ key, bytes: value === null ? 0 : utf8Bytes(value) })
  }
  return entries
}

export function writeEngineSuspendSnapshot(input: {
  tabId: string
  engineId: string
  fileKey: string
  payload: unknown
  now?: number
  storage?: Storage
}): boolean {
  const storage =
    input.storage ?? (typeof sessionStorage === "undefined" ? undefined : sessionStorage)
  if (!storage) return false
  try {
    const key = snapshotKey(input.tabId)
    const serialized = JSON.stringify({
      version: 1,
      tabId: input.tabId,
      engineId: input.engineId,
      fileKey: input.fileKey,
      updatedAt: input.now ?? Date.now(),
      payload: input.payload,
    } satisfies EngineSuspendEnvelope)
    const serializedBytes = utf8Bytes(serialized)
    if (serializedBytes > MAX_ENGINE_SUSPEND_SNAPSHOT_BYTES) {
      storage.removeItem(key)
      return false
    }
    const entries = snapshotEntries(storage)
    const previousBytes = entries.find((entry) => entry.key === key)?.bytes ?? 0
    const countAfter = entries.some((entry) => entry.key === key)
      ? entries.length
      : entries.length + 1
    const bytesAfter =
      entries.reduce((total, entry) => total + entry.bytes, 0) - previousBytes + serializedBytes
    if (countAfter > MAX_ENGINE_SUSPEND_SNAPSHOTS || bytesAfter > MAX_ENGINE_SUSPEND_TOTAL_BYTES) {
      storage.removeItem(key)
      return false
    }
    storage.setItem(key, serialized)
    return true
  } catch {
    try {
      storage.removeItem(snapshotKey(input.tabId))
    } catch {}
    return false
  }
}

export function readEngineSuspendSnapshot<T>(input: {
  tabId: string
  engineId: string
  fileKey: string
  validate: (payload: unknown) => payload is T
  storage?: Storage
}): T | null {
  const storage =
    input.storage ?? (typeof sessionStorage === "undefined" ? undefined : sessionStorage)
  if (!storage) return null
  let key: string | undefined
  try {
    key = snapshotKey(input.tabId)
    const raw = storage.getItem(key)
    if (raw === null) return null
    // Apply the same UTF-8 bound on recovery. A malformed/foreign storage writer must not make
    // remount parse an arbitrarily large payload that our own writer would reject.
    if (utf8Bytes(raw) > MAX_ENGINE_SUSPEND_SNAPSHOT_BYTES) {
      storage.removeItem(key)
      return null
    }
    const parsed = JSON.parse(raw) as Partial<EngineSuspendEnvelope> | null
    if (
      !parsed ||
      parsed.version !== 1 ||
      parsed.tabId !== input.tabId ||
      parsed.engineId !== input.engineId ||
      parsed.fileKey !== input.fileKey ||
      !input.validate(parsed.payload)
    ) {
      storage.removeItem(key)
      return null
    }
    return parsed.payload
  } catch {
    try {
      if (key) storage.removeItem(key)
    } catch {}
    return null
  }
}

export function clearEngineSuspendSnapshot(tabId: string, storage?: Storage): void {
  const target = storage ?? (typeof sessionStorage === "undefined" ? undefined : sessionStorage)
  try {
    target?.removeItem(snapshotKey(tabId))
  } catch {}
}
