/** 为已有记录生成严格递增的本地更新时间，避免同一毫秒内版本碰撞。 */
export function nextUpdatedAt(previousUpdatedAt: number, now = Date.now()): number {
  return Math.max(now, previousUpdatedAt + 1)
}
