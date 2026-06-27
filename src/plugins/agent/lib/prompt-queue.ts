// 异步提示队列 —— ACP 客户端会话的多轮驱动: push 入队用户提示; next() 取下一条 (队空则等待);
// close() 后唤醒所有等待者 (返回 null)、之后 push 忽略、next 即 null —— 让驱动循环优雅退出。
// 纯逻辑、无外部依赖 (便于单测)。
export class PromptQueue {
  private items: string[] = []
  private waiters: Array<(v: string | null) => void> = []
  private closed = false

  /** 入队一条提示 (close 后忽略)。 */
  push(text: string): void {
    if (this.closed) return
    const w = this.waiters.shift()
    if (w) w(text)
    else this.items.push(text)
  }

  /** 取下一条提示; 队空则等待; close 且排空后返回 null。 */
  next(): Promise<string | null> {
    const buffered = this.items.shift()
    if (buffered !== undefined) return Promise.resolve(buffered)
    if (this.closed) return Promise.resolve(null)
    return new Promise<string | null>((resolve) => this.waiters.push(resolve))
  }

  /** 关闭: 唤醒所有等待者 (返回 null); 之后 push 忽略、next 立即 null。幂等。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const w of this.waiters.splice(0)) w(null)
  }
}
