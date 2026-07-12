/**
 * 有界并发执行异步任务，并按输入顺序返回结果。
 *
 * 任一任务失败后不再调度新任务；已启动任务完成后，抛出输入位置最靠前的错误。
 */
export async function mapConcurrentOrdered<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []

  const results = new Array<R>(items.length)
  const failures: Array<{ index: number; error: unknown }> = []
  let nextIndex = 0
  let stopped = false

  const worker = async () => {
    while (!stopped) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      try {
        results[index] = await task(items[index], index)
      } catch (error) {
        failures.push({ index, error })
        stopped = true
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  if (failures.length > 0) {
    failures.sort((left, right) => left.index - right.index)
    throw failures[0].error
  }
  return results
}
