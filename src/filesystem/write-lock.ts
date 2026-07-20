import { fileRefKey, type FileRef } from "@protocol/file-system"

const WEB_LOCK_PREFIX = "ideall:file-write:"

export class KeyedPromiseMutex {
  private readonly tails = new Map<string, Promise<void>>()

  get pendingKeyCount(): number {
    return this.tails.size
  }

  async runExclusive<T>(key: string, operation: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(key)
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    this.tails.set(key, current)

    if (previous) await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.tails.get(key) === current) this.tails.delete(key)
    }
  }
}

const inProcessWriteMutex = new KeyedPromiseMutex()

function webLockManager(): LockManager | null {
  if (typeof navigator === "undefined") return null
  try {
    return navigator.locks && typeof navigator.locks.request === "function" ? navigator.locks : null
  } catch {
    return null
  }
}

async function webLockName(key: string): Promise<string> {
  try {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")
      return `${WEB_LOCK_PREFIX}${hash}`
    }
  } catch {
    // Web Locks can exist in an unusual runtime without a usable SubtleCrypto implementation.
  }
  return `${WEB_LOCK_PREFIX}${key}`
}

/**
 * Serializes a file mutation across same-origin windows when Web Locks are available,
 * with a process-local mutex for SSR and runtimes without that API.
 */
export async function withFileWriteLock<T>(
  ref: FileRef,
  operation: () => T | Promise<T>,
): Promise<T> {
  const key = fileRefKey(ref)
  const manager = webLockManager()
  if (!manager) return inProcessWriteMutex.runExclusive(key, operation)

  let callbackStarted = false
  try {
    const name = await webLockName(key)
    return (await manager.request(name, async () => {
      callbackStarted = true
      return operation()
    })) as T
  } catch (error) {
    // A failed operation must never be replayed. A lock request rejected before granting can
    // safely use the local fallback, which covers partially implemented Web Locks runtimes.
    if (callbackStarted) throw error
    return inProcessWriteMutex.runExclusive(key, operation)
  }
}
