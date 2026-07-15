export type TrashRefreshTarget = Readonly<{
  targetKey: string
  generation: number
}>

export type TrashRefreshRequest = Readonly<{
  target: TrashRefreshTarget
  generation: number
}>

export type TrashRefreshCoordinator = Readonly<{
  activate(targetKey: string): TrashRefreshTarget
  deactivate(target: TrashRefreshTarget): void
  begin(target: TrashRefreshTarget): TrashRefreshRequest | null
  isTargetActive(target: TrashRefreshTarget): boolean
  isCurrent(request: TrashRefreshRequest): boolean
}>

export type TrashRefreshViewTarget = Readonly<{
  targetKey: string
}>

export type TrashRefreshViewState<T> = Readonly<{
  target: TrashRefreshViewTarget
  items: readonly T[]
  loading: boolean
}>

export type TrashRefreshView<T> = Readonly<{
  items: readonly T[]
  loading: boolean
}>

export type TrashRefreshCallbacks<T> = Readonly<{
  onStart(request: TrashRefreshRequest): void
  onSuccess(value: T, request: TrashRefreshRequest): void
  onError(error: unknown, request: TrashRefreshRequest): void
}>

export type TrashRefreshRunResult = "skipped" | "stale" | "success" | "error"

export type TrashMutationAction = "restore" | "purge" | "empty"

export type TrashMutationGuardState = Readonly<{
  loading: boolean
  mutationBusy: boolean
}>

/** 列表直达 restore 不能使用 loading 中的旧项；已确认 action 继续依靠其冻结版本执行 CAS。 */
export function canStartTrashMutation(
  action: TrashMutationAction,
  state: TrashMutationGuardState,
): boolean {
  return !state.mutationBusy && (action !== "restore" || !state.loading)
}

/** refresh 会同步登记 loading/request；mutation busy 随后立即释放，不等待可能失效的 I/O。 */
export function settleTrashMutationWithRefresh(
  startRefresh: () => Promise<void>,
  releaseMutation: () => void,
): Promise<void> {
  let settling: Promise<void>
  try {
    settling = startRefresh()
  } finally {
    releaseMutation()
  }
  return settling
}

/** root render 已切换而新 effect 尚未启动时，也不能短暂暴露旧 root 的列表。 */
export function visibleTrashRefreshView<T>(
  state: TrashRefreshViewState<T>,
  target: TrashRefreshViewTarget,
): TrashRefreshView<T> {
  return state.target === target
    ? { items: state.items, loading: state.loading }
    : { items: [], loading: true }
}

export function startTrashRefresh<T>(
  state: TrashRefreshViewState<T>,
  target: TrashRefreshViewTarget,
): TrashRefreshViewState<T> {
  return {
    target,
    items: state.target === target ? state.items : [],
    loading: true,
  }
}

export function completeTrashRefresh<T>(
  target: TrashRefreshViewTarget,
  items: readonly T[],
): TrashRefreshViewState<T> {
  return { target, items, loading: false }
}

/** 读取失败保留同 root 的 last-good；跨 root 时绝不带入旧数据。 */
export function failTrashRefresh<T>(
  state: TrashRefreshViewState<T>,
  target: TrashRefreshViewTarget,
): TrashRefreshViewState<T> {
  return {
    target,
    items: state.target === target ? state.items : [],
    loading: false,
  }
}

/** 异步读取只把 current request 的开始、成功或失败交给 Display 提交。 */
export async function runTrashRefreshRequest<T>(
  coordinator: TrashRefreshCoordinator,
  target: TrashRefreshTarget,
  read: () => Promise<T>,
  callbacks: TrashRefreshCallbacks<T>,
): Promise<TrashRefreshRunResult> {
  const request = coordinator.begin(target)
  if (!request) return "skipped"
  callbacks.onStart(request)

  let value: T
  try {
    value = await read()
  } catch (error) {
    if (!coordinator.isCurrent(request)) return "stale"
    callbacks.onError(error, request)
    return "error"
  }

  if (!coordinator.isCurrent(request)) return "stale"
  callbacks.onSuccess(value, request)
  return "success"
}

/**
 * 为一个 Trash Display 实例串行化可提交的 refresh 身份。
 *
 * target token 防止卸载、root 切换以及 A -> B -> A 后的旧生命周期复活；request token
 * 保证同一 target 上只有最后启动的读取可以提交结果。
 */
export function createTrashRefreshCoordinator(): TrashRefreshCoordinator {
  let targetGeneration = 0
  let requestGeneration = 0
  let activeTarget: TrashRefreshTarget | null = null
  let currentRequest: TrashRefreshRequest | null = null

  function isTargetActive(target: TrashRefreshTarget): boolean {
    return (
      activeTarget?.generation === target.generation && activeTarget.targetKey === target.targetKey
    )
  }

  return Object.freeze({
    activate(targetKey) {
      const target = Object.freeze({ targetKey, generation: ++targetGeneration })
      activeTarget = target
      currentRequest = null
      return target
    },
    deactivate(target) {
      if (!isTargetActive(target)) return
      activeTarget = null
      currentRequest = null
    },
    begin(target) {
      if (!isTargetActive(target)) return null
      const request = Object.freeze({ target, generation: ++requestGeneration })
      currentRequest = request
      return request
    },
    isTargetActive,
    isCurrent(request) {
      return (
        isTargetActive(request.target) &&
        currentRequest?.generation === request.generation &&
        currentRequest.target.generation === request.target.generation
      )
    },
  })
}
