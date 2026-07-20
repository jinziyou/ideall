const PLUGIN_MUTATION_CHANNEL_NAME = "ideall:plugin-mutation:v1"
const PLUGIN_MUTATION_SENDER = createSenderId()

type PluginMutationBroadcast = {
  sender: string
  fileSystemId: string
}

export type PluginMutationInvalidationSource = "local" | "broadcast"

export type PluginMutationInvalidationChannel = Readonly<{
  publish(): void
  subscribe(listener: (source: PluginMutationInvalidationSource) => void): () => void
}>

type PluginMutationListener = (source: PluginMutationInvalidationSource) => void

const localListeners = new Map<string, Set<PluginMutationListener>>()
let sharedBroadcastChannel: BroadcastChannel | null = null
let activeSubscriptions = 0

function createSenderId(): string {
  try {
    return globalThis.crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  try {
    const actual = Object.keys(value)
    return actual.length === keys.length && actual.every((key) => keys.includes(key))
  } catch {
    return false
  }
}

function readBroadcast(value: unknown): PluginMutationBroadcast | null {
  if (!isExactRecord(value, ["sender", "fileSystemId"])) return null
  try {
    return typeof value.sender === "string" &&
      value.sender.length > 0 &&
      typeof value.fileSystemId === "string" &&
      value.fileSystemId.length > 0
      ? { sender: value.sender, fileSystemId: value.fileSystemId }
      : null
  } catch {
    return null
  }
}

function openBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null
  try {
    const Channel = window.BroadcastChannel
    return typeof Channel === "function" ? new Channel(PLUGIN_MUTATION_CHANNEL_NAME) : null
  } catch {
    return null
  }
}

function deliver(fileSystemId: string, source: PluginMutationInvalidationSource): void {
  for (const listener of [...(localListeners.get(fileSystemId) ?? [])]) {
    try {
      listener(source)
    } catch {
      // 失效监听器互相隔离；已提交 import 不能因 Display 回调异常被误报失败。
    }
  }
}

function onBroadcastMessage(event: MessageEvent<unknown>): void {
  const message = readBroadcast(event.data)
  if (!message || message.sender === PLUGIN_MUTATION_SENDER) return
  deliver(message.fileSystemId, "broadcast")
}

function ensureSharedBroadcastChannel(): BroadcastChannel | null {
  if (sharedBroadcastChannel) return sharedBroadcastChannel
  const channel = openBroadcastChannel()
  if (!channel) return null
  try {
    channel.addEventListener("message", onBroadcastMessage)
    sharedBroadcastChannel = channel
    return channel
  } catch {
    try {
      channel.close()
    } catch {}
    return null
  }
}

function closeSharedBroadcastChannel(): void {
  const channel = sharedBroadcastChannel
  sharedBroadcastChannel = null
  if (!channel) return
  try {
    channel.removeEventListener("message", onBroadcastMessage)
  } catch {}
  try {
    channel.close()
  } catch {}
}

/**
 * 为一个插件 FileSystem 创建失效通道。插件内 adapter/provider 共享同一 scope；同窗口直接
 * 通知，Tauri 多窗口经 BroadcastChannel 仅传 fileSystemId，接收方必须重读 Storage。
 */
export function createPluginMutationInvalidationChannel(
  fileSystemId: string,
): PluginMutationInvalidationChannel {
  if (!fileSystemId) throw new Error("Plugin mutation channel requires a fileSystemId")
  return Object.freeze({
    publish() {
      deliver(fileSystemId, "local")
      const sharedChannel = sharedBroadcastChannel
      const channel = sharedChannel ?? openBroadcastChannel()
      if (!channel) return
      try {
        channel.postMessage({
          sender: PLUGIN_MUTATION_SENDER,
          fileSystemId,
        } satisfies PluginMutationBroadcast)
      } catch {
        // 保留同窗口失效；跨窗口 transport 不可用时不反转已提交的 Storage mutation。
      } finally {
        if (!sharedChannel) {
          try {
            channel.close()
          } catch {}
        }
      }
    },
    subscribe(listener) {
      const listeners = localListeners.get(fileSystemId) ?? new Set<PluginMutationListener>()
      // 每次 subscribe 都拥有独立身份；同一个 callback 被重复订阅时也能分别释放。
      const subscriptionListener: PluginMutationListener = (source) => listener(source)
      listeners.add(subscriptionListener)
      localListeners.set(fileSystemId, listeners)
      activeSubscriptions += 1
      ensureSharedBroadcastChannel()

      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        listeners.delete(subscriptionListener)
        if (listeners.size === 0) localListeners.delete(fileSystemId)
        activeSubscriptions -= 1
        if (activeSubscriptions === 0) closeSharedBroadcastChannel()
      }
    },
  })
}
