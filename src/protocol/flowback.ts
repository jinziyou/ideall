// 「我的」写入事件接口约定 —— 任何「加入我的」的写入 (关注 / 固定工具 / 收藏 / 添加资源) 成功后广播,
// 让「我的」/头部的「我的」计数实时更新。事件不落库；同窗口走 CustomEvent，窗口间只用
// BroadcastChannel 发送脱敏失效信号，接收方仍须从 Storage 重读真值。

export const FILES_UPDATED = "ideall:files-updated"
/** 跨端同步完成事件 (sync 插件在合并写本地后广播); 同时监听旧 wonita 事件名以兼容已加载旧窗口。 */
export const SUBSCRIPTIONS_SYNCED = "ideall:subscriptions-synced"
const LEGACY_SUBSCRIPTIONS_SYNCED = "wonita:subscriptions-synced"
const FILES_UPDATED_CHANNEL = "ideall:files-updated:v1"
const FILES_UPDATED_SENDER = createSenderId()

/** 写入 payload (§7/§9): 哪个 kind 的哪个 id 变了 —— live-merge 据此只重读该条, 不被任何「我的」写惊动。缺省=未知。 */
export type FilesUpdate = { kind?: string; id?: string; subType?: string }

type FilesUpdateBroadcast = {
  sender: string
  detail: FilesUpdate
}

function createSenderId(): string {
  try {
    return globalThis.crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

function cleanFilesUpdate(detail?: FilesUpdate): FilesUpdate {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {}
  try {
    const clean: FilesUpdate = {}
    if (typeof detail.kind === "string") clean.kind = detail.kind
    if (typeof detail.id === "string") clean.id = detail.id
    if (typeof detail.subType === "string") clean.subType = detail.subType
    return clean
  } catch {
    return {}
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

function readBroadcast(value: unknown): FilesUpdateBroadcast | null {
  try {
    if (!isExactRecord(value, ["sender", "detail"])) return null
    if (typeof value.sender !== "string" || value.sender.length === 0) return null
    if (!value.detail || typeof value.detail !== "object" || Array.isArray(value.detail))
      return null
    const detail = value.detail as Record<string, unknown>
    const allowedKeys = ["kind", "id", "subType"] as const
    const actualKeys = Object.keys(detail)
    if (
      actualKeys.some(
        (key) =>
          !allowedKeys.includes(key as (typeof allowedKeys)[number]) ||
          typeof detail[key] !== "string",
      )
    ) {
      return null
    }
    return { sender: value.sender, detail: cleanFilesUpdate(detail as FilesUpdate) }
  } catch {
    return null
  }
}

function openFilesUpdatedChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null
  try {
    const Channel = window.BroadcastChannel
    return typeof Channel === "function" ? new Channel(FILES_UPDATED_CHANNEL) : null
  } catch {
    return null
  }
}

export function notifyFilesUpdated(detail?: FilesUpdate) {
  if (typeof window === "undefined") return
  const cleanDetail = cleanFilesUpdate(detail)
  try {
    window.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: cleanDetail }))
  } catch {
    /* SSR / 不支持时忽略 */
  }

  const channel = openFilesUpdatedChannel()
  if (!channel) return
  try {
    channel.postMessage({ sender: FILES_UPDATED_SENDER, detail: cleanDetail })
  } catch {
    /* 通道关闭 / 序列化失败时保留同窗口通知 */
  } finally {
    try {
      channel.close()
    } catch {
      /* 通道实现异常时忽略 */
    }
  }
}

/** 「我的」写入 + 同步完成事件; cb 收到 {kind,id} payload (旧 cb 忽略入参即可)。返回取消监听函数。SSR 安全。 */
export function onFilesUpdated(cb: (detail?: FilesUpdate) => void): () => void {
  if (typeof window === "undefined") return () => {}
  const target = window
  const h = (e: Event) => cb((e as CustomEvent<FilesUpdate>).detail)
  target.addEventListener(FILES_UPDATED, h)
  target.addEventListener(SUBSCRIPTIONS_SYNCED, h)
  target.addEventListener(LEGACY_SUBSCRIPTIONS_SYNCED, h)
  let channel = openFilesUpdatedChannel()
  const onMessage = (event: MessageEvent<unknown>) => {
    const message = readBroadcast(event.data)
    if (message && message.sender !== FILES_UPDATED_SENDER) cb(message.detail)
  }
  if (channel) {
    try {
      channel.addEventListener("message", onMessage)
    } catch {
      try {
        channel.close()
      } catch {
        /* 通道实现异常时忽略 */
      }
      channel = null
    }
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    target.removeEventListener(FILES_UPDATED, h)
    target.removeEventListener(SUBSCRIPTIONS_SYNCED, h)
    target.removeEventListener(LEGACY_SUBSCRIPTIONS_SYNCED, h)
    if (!channel) return
    try {
      channel.removeEventListener("message", onMessage)
    } catch {
      /* 通道实现异常时仍尝试关闭 */
    }
    try {
      channel.close()
    } catch {
      /* 通道实现异常时忽略 */
    }
    channel = null
  }
}
