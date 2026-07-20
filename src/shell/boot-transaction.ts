export type RegistrationDisposer = () => void
export type RegistrationStep = () => void | RegistrationDisposer

function disposeReverse(disposers: RegistrationDisposer[]): unknown[] {
  const failures: unknown[] = []
  for (let index = disposers.length - 1; index >= 0; index -= 1) {
    try {
      disposers[index]?.()
    } catch (error) {
      failures.push(error)
    }
  }
  return failures
}

/**
 * 同步组合根事务：步骤只在全部成功后可见为“已启动”；失败时按逆序回滚已注册贡献。
 * disposer 自身幂等，便于测试/HMR 显式卸载。
 */
export function runRegistrationTransaction(
  steps: readonly RegistrationStep[],
): RegistrationDisposer {
  const disposers: RegistrationDisposer[] = []
  try {
    for (const step of steps) {
      const dispose = step()
      if (dispose) disposers.push(dispose)
    }
  } catch (error) {
    const rollbackFailures = disposeReverse(disposers)
    if (rollbackFailures.length) {
      throw new AggregateError(
        [error, ...rollbackFailures],
        "Composition root registration and rollback failed",
        { cause: error },
      )
    }
    throw error
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    const failures = disposeReverse(disposers)
    if (failures.length) throw new AggregateError(failures, "Composition root disposal failed")
  }
}
