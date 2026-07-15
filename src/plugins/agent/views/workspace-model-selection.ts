export type WorkspaceModelSelectionPhase = "flush" | "apply"

export type WorkspaceModelSelectionDisplayState = Readonly<{
  workspaceId: string
  value: string
  generation: number
  status: "settled" | "pending" | "awaiting-source"
  observedSourceValue: string
  observedSourceVersion: string
  sourceAtAcknowledgement: string | null
  sourceVersionAtAcknowledgement: string | null
}>

export type WorkspaceModelSelectionToken = Readonly<{
  workspaceId: string
  generation: number
}>

export function createWorkspaceModelSelectionDisplayState(
  workspaceId: string,
  sourceValue: string,
  sourceVersion: string,
): WorkspaceModelSelectionDisplayState {
  return Object.freeze({
    workspaceId,
    value: sourceValue,
    generation: 0,
    status: "settled",
    observedSourceValue: sourceValue,
    observedSourceVersion: sourceVersion,
    sourceAtAcknowledgement: null,
    sourceVersionAtAcknowledgement: null,
  })
}

export function reconcileWorkspaceModelSelectionDisplay(
  current: WorkspaceModelSelectionDisplayState,
  workspaceId: string,
  sourceValue: string,
  sourceVersion: string,
): WorkspaceModelSelectionDisplayState {
  if (current.workspaceId !== workspaceId) {
    return {
      ...createWorkspaceModelSelectionDisplayState(workspaceId, sourceValue, sourceVersion),
      // Keep generations monotonic across workspace switches so ws-a → ws-b → ws-a cannot let
      // the first ws-a operation match a newly allocated token.
      generation: current.generation + 1,
    }
  }

  const sourceChanged =
    current.observedSourceValue !== sourceValue || current.observedSourceVersion !== sourceVersion
  const observed = sourceChanged
    ? { ...current, observedSourceValue: sourceValue, observedSourceVersion: sourceVersion }
    : current

  if (current.status === "pending") return observed
  if (current.status === "awaiting-source") {
    if (sourceValue === current.value) {
      return {
        ...observed,
        status: "settled",
        sourceAtAcknowledgement: null,
        sourceVersionAtAcknowledgement: null,
      }
    }
    const transitionedSinceAcknowledgement =
      sourceChanged &&
      (sourceValue !== current.sourceAtAcknowledgement ||
        sourceVersion !== current.sourceVersionAtAcknowledgement)
    return transitionedSinceAcknowledgement
      ? {
          ...observed,
          value: sourceValue,
          status: "settled",
          sourceAtAcknowledgement: null,
          sourceVersionAtAcknowledgement: null,
        }
      : observed
  }
  return observed.value === sourceValue ? observed : { ...observed, value: sourceValue }
}

export function beginWorkspaceModelSelection(
  current: WorkspaceModelSelectionDisplayState,
  workspaceId: string,
  sourceValue: string,
  sourceVersion: string,
  value: string,
): Readonly<{ state: WorkspaceModelSelectionDisplayState; token: WorkspaceModelSelectionToken }> {
  const reconciled = reconcileWorkspaceModelSelectionDisplay(
    current,
    workspaceId,
    sourceValue,
    sourceVersion,
  )
  const generation = reconciled.generation + 1
  return Object.freeze({
    state: {
      ...reconciled,
      value,
      generation,
      status: "pending",
      sourceAtAcknowledgement: null,
      sourceVersionAtAcknowledgement: null,
    },
    token: Object.freeze({ workspaceId, generation }),
  })
}

function isCurrentWorkspaceModelSelection(
  current: WorkspaceModelSelectionDisplayState,
  token: WorkspaceModelSelectionToken,
): boolean {
  return current.workspaceId === token.workspaceId && current.generation === token.generation
}

export function acknowledgeWorkspaceModelSelection(
  current: WorkspaceModelSelectionDisplayState,
  token: WorkspaceModelSelectionToken,
): WorkspaceModelSelectionDisplayState {
  if (!isCurrentWorkspaceModelSelection(current, token)) return current
  const sourceAlreadyMatches = current.observedSourceValue === current.value
  return {
    ...current,
    status: sourceAlreadyMatches ? "settled" : "awaiting-source",
    sourceAtAcknowledgement: sourceAlreadyMatches ? null : current.observedSourceValue,
    sourceVersionAtAcknowledgement: sourceAlreadyMatches ? null : current.observedSourceVersion,
  }
}

export function rejectWorkspaceModelSelection(
  current: WorkspaceModelSelectionDisplayState,
  token: WorkspaceModelSelectionToken,
): WorkspaceModelSelectionDisplayState {
  if (!isCurrentWorkspaceModelSelection(current, token)) return current
  return {
    ...current,
    value: current.observedSourceValue,
    status: "settled",
    sourceAtAcknowledgement: null,
    sourceVersionAtAcknowledgement: null,
  }
}

export type WorkspaceModelSelectionError<TSelection> = Readonly<{
  selection: TSelection
  generation: number
  phase: WorkspaceModelSelectionPhase
  error: unknown
}>

type WorkspaceModelSelectionCoordinatorOptions<TSelection> = Readonly<{
  flushDrafts(): Promise<void>
  apply(selection: TSelection): Promise<void>
  onError?(failure: WorkspaceModelSelectionError<TSelection>): void
}>

/**
 * Serializes direct model selections behind text-draft persistence. A newer selection supersedes
 * older work that has not entered its direct write yet; an already-started write still settles
 * before the newer selection runs, so completion order always matches user intent order.
 */
export function createWorkspaceModelSelectionCoordinator<TSelection>(
  options: WorkspaceModelSelectionCoordinatorOptions<TSelection>,
) {
  let latestGeneration = 0
  let tail: Promise<void> = Promise.resolve()

  function select(selection: TSelection): Promise<boolean> {
    const generation = ++latestGeneration
    const execution = tail.then(async () => {
      if (generation !== latestGeneration) return false

      try {
        await options.flushDrafts()
      } catch (error) {
        options.onError?.({ selection, generation, phase: "flush", error })
        throw error
      }

      if (generation !== latestGeneration) return false

      try {
        await options.apply(selection)
      } catch (error) {
        options.onError?.({ selection, generation, phase: "apply", error })
        throw error
      }
      return true
    })

    // One failed intent must not poison later selections.
    tail = execution.then(
      () => undefined,
      () => undefined,
    )
    return execution
  }

  return Object.freeze({ select })
}
