/**
 * 生成本地实体 ID: `<prefix>_<base36 时间戳>_<base36 随机后缀>`。
 *
 * 时间戳前缀让 ID 大致按创建时间有序, 随机后缀避免同一毫秒内的碰撞。
 * 仅用于浏览器本地存储 (书签 / 文件) 的主键, 不依赖服务端发号。
 */
export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
