export type NavigationRequestLease = Readonly<{
  epoch: number
  isCurrent(): boolean
}>

/**
 * 封装“后发导航胜出”的递增 epoch。lease 不持有取消副作用；调用方在每个异步提交点检查
 * isCurrent，invalidate 则令当前及更早 lease 一次性失效。
 */
export class NavigationRequestCoordinator {
  #epoch = 0

  begin(): NavigationRequestLease {
    const epoch = ++this.#epoch
    return Object.freeze({
      epoch,
      isCurrent: () => epoch === this.#epoch,
    })
  }

  invalidate(): void {
    this.#epoch += 1
  }

  currentEpoch(): number {
    return this.#epoch
  }
}
