/**
 * 生成本地实体 ID: `<prefix>_<base36 时间戳>_<base36 随机后缀>`。
 *
 * 时间戳前缀让 ID 大致按创建时间有序, 随机后缀避免同一毫秒内的碰撞。
 * 仅用于浏览器本地存储 (书签 / 文件) 的主键, 不依赖服务端发号。
 */
export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 随机唯一 ID (UUID 优先): crypto.randomUUID 仅安全上下文 (localhost / https) 可用,
 * 非安全 HTTP 下退化为时间戳+随机。用于无前缀语义的一次性标识 (消息 id / OAuth state 等)。
 */
export function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
  } catch {
    /* 落到下面的退化方案 */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
