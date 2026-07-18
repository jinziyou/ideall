import { fileRefKey, type IdeallFile } from "@protocol/file-system"

/**
 * 最近使用记录（recently-used.xbel 类比，docs/freedesktop-alignment.md §6 S5a）。
 *
 * 隐私契约（新数据收集，用户显式拍板）：
 * - **默认关闭**：`ideall:recently-used:enabled` 不显式置 "1" 时一条都不记录；
 * - **隐身暂停**：paused 期间停止记录，既有条目保留；
 * - **可清空 / 可逐条移除 / 可逐条标记私密**（XBEL private 语义：保留在文件里、
 *   不在普通列表展示）；
 * - 归 `state` 存储类：不进入同步、不进入归档导出（LocalDataSchema 登记）。
 *
 * 重新打开同一条目时提升到最前并保留其私密标记。
 */

export const RECENTLY_USED_STORAGE_KEY = "ideall:recently-used:v1"
export const RECENTLY_USED_ENABLED_KEY = "ideall:recently-used:enabled"
export const RECENTLY_USED_PAUSED_KEY = "ideall:recently-used:paused"
export const RECENTLY_USED_LIMIT = 100

export type RecentlyUsedEntry = Readonly<{
  /** FileRef 的稳定 key（fileRefKey 编码，可经 parseFileRefKey 还原）。 */
  refKey: string
  name: string
  mediaType: string
  engineId: string
  openedAt: number
  /** XBEL private 语义：保留在文件里但不在普通列表展示。 */
  private?: true
}>

type RecentlyUsedDocument = Readonly<{ version: 1; entries: readonly RecentlyUsedEntry[] }>

const listeners = new Set<() => void>()
let cache: { raw: string | null; document: RecentlyUsedDocument } | null = null

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // 观察者异常不影响其余订阅者。
    }
  }
}

function sanitizeEntry(value: unknown): RecentlyUsedEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    typeof record.refKey !== "string" ||
    record.refKey.length === 0 ||
    typeof record.name !== "string" ||
    typeof record.mediaType !== "string" ||
    typeof record.engineId !== "string" ||
    record.engineId.length === 0 ||
    !Number.isSafeInteger(record.openedAt) ||
    (record.openedAt as number) <= 0
  ) {
    return null
  }
  return Object.freeze({
    refKey: record.refKey,
    name: record.name,
    mediaType: record.mediaType,
    engineId: record.engineId,
    openedAt: record.openedAt as number,
    ...(record.private === true ? { private: true as const } : {}),
  })
}

function readDocument(): RecentlyUsedDocument {
  let raw: string | null = null
  try {
    raw = storage()?.getItem(RECENTLY_USED_STORAGE_KEY) ?? null
  } catch {
    raw = null
  }
  if (cache && cache.raw === raw) return cache.document
  let document: RecentlyUsedDocument = Object.freeze({ version: 1, entries: Object.freeze([]) })
  try {
    if (raw) {
      const parsed = JSON.parse(raw) as { entries?: unknown }
      if (Array.isArray(parsed?.entries)) {
        document = Object.freeze({
          version: 1,
          entries: Object.freeze(
            parsed.entries
              .map(sanitizeEntry)
              .filter((entry): entry is RecentlyUsedEntry => entry !== null)
              .slice(0, RECENTLY_USED_LIMIT),
          ),
        })
      }
    }
  } catch {
    // 数据损坏时视为空（可经 schema 修复面移除）。
  }
  cache = { raw, document }
  return document
}

function writeDocument(entries: readonly RecentlyUsedEntry[]): void {
  const document: RecentlyUsedDocument = Object.freeze({
    version: 1,
    entries: Object.freeze(entries.slice(0, RECENTLY_USED_LIMIT)),
  })
  const raw = JSON.stringify(document)
  try {
    storage()?.setItem(RECENTLY_USED_STORAGE_KEY, raw)
  } catch {
    // 隐私模式 / 配额满：仅更新内存缓存，本会话内一致。
  }
  cache = { raw, document }
  notify()
}

export function isRecentlyUsedEnabled(): boolean {
  try {
    return storage()?.getItem(RECENTLY_USED_ENABLED_KEY) === "1"
  } catch {
    return false
  }
}

export function setRecentlyUsedEnabled(enabled: boolean): void {
  try {
    storage()?.setItem(RECENTLY_USED_ENABLED_KEY, enabled ? "1" : "0")
  } catch {
    /* ignore */
  }
  notify()
}

export function isRecentlyUsedPaused(): boolean {
  try {
    return storage()?.getItem(RECENTLY_USED_PAUSED_KEY) === "1"
  } catch {
    return false
  }
}

export function setRecentlyUsedPaused(paused: boolean): void {
  try {
    storage()?.setItem(RECENTLY_USED_PAUSED_KEY, paused ? "1" : "0")
  } catch {
    /* ignore */
  }
  notify()
}

/** 记录一次文件打开。未启用 / 隐身暂停 / 非文件一律 no-op；绝不抛出（记录是旁路面）。 */
export function recordFileOpen(file: IdeallFile, engineId: string, openedAt = Date.now()): void {
  try {
    if (file.kind !== "file" || !isRecentlyUsedEnabled() || isRecentlyUsedPaused()) return
    const refKey = fileRefKey(file.ref)
    const entries = readDocument().entries
    const previous = entries.find((entry) => entry.refKey === refKey)
    const next: RecentlyUsedEntry = Object.freeze({
      refKey,
      name: file.name,
      mediaType: file.mediaType,
      engineId,
      openedAt,
      ...(previous?.private === true ? { private: true as const } : {}),
    })
    writeDocument([next, ...entries.filter((entry) => entry.refKey !== refKey)])
  } catch {
    // 记录失败不得影响打开路径。
  }
}

/** 全部条目（含私密项；普通列表在展示层过滤 private）。 */
export function listRecentlyUsed(): readonly RecentlyUsedEntry[] {
  return readDocument().entries
}

export function removeRecentlyUsedEntry(refKey: string): void {
  writeDocument(readDocument().entries.filter((entry) => entry.refKey !== refKey))
}

export function setRecentlyUsedEntryPrivate(refKey: string, value: boolean): void {
  writeDocument(
    readDocument().entries.map((entry) => {
      if (entry.refKey !== refKey) return entry
      const { private: _private, ...rest } = entry
      return Object.freeze(value ? { ...rest, private: true as const } : rest)
    }),
  )
}

export function clearRecentlyUsed(): void {
  writeDocument([])
}

export function subscribeRecentlyUsed(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === RECENTLY_USED_STORAGE_KEY ||
      event.key === RECENTLY_USED_ENABLED_KEY ||
      event.key === RECENTLY_USED_PAUSED_KEY ||
      event.key === null
    ) {
      listener()
    }
  }
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage)
  }
  return () => {
    listeners.delete(listener)
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage)
    }
  }
}
