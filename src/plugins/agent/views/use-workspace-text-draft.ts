"use client"

import * as React from "react"

export type WorkspaceTextDraftCommit<TContext> = Readonly<{
  workspaceId: string
  generation: number
  value: string
  context: TContext
}>

export type WorkspaceTextDraftErrorAction = "keep" | "clear"

type DraftCommitQueueOptions<TContext, TResult> = Readonly<{
  debounceMs: number
  commit(item: WorkspaceTextDraftCommit<TContext>): Promise<TResult>
  onSuccess?(item: WorkspaceTextDraftCommit<TContext>, result: TResult): void
  onError?(
    item: WorkspaceTextDraftCommit<TContext>,
    error: unknown,
  ): WorkspaceTextDraftErrorAction | void
}>

type PendingDraftCommit<TContext> = Readonly<{
  item: WorkspaceTextDraftCommit<TContext>
  submission: number
}>

/**
 * Debounces pending text while preserving a single serialized persistence tail. A newer pending
 * generation replaces only work that has not entered the tail; an in-flight commit always settles
 * before the next generation starts.
 */
export function createSerializedDraftCommitQueue<TContext, TResult = unknown>(
  options: DraftCommitQueueOptions<TContext, TResult>,
) {
  let pending: PendingDraftCommit<TContext> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  // Serialization must recover from a rejection so later generations can run, while callers of
  // flush must still observe the latest durable attempt's real settlement.
  let serializationTail: Promise<void> = Promise.resolve()
  let latestSettlement: Promise<void> = serializationTail
  let disposed = false
  let latestSubmission = 0

  function clearTimer(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  function enqueue(entry: PendingDraftCommit<TContext>): Promise<void> {
    const { item } = entry
    const execution = serializationTail.then(async () => {
      const result = await options.commit(item)
      options.onSuccess?.(item, result)
    })
    const observed = execution.catch((error: unknown) => {
      const action = options.onError?.(item, error)
      // A failed latest generation stays available for the next explicit flush. Do not arm a
      // timer here: storage failures must not create an immediate retry loop. A newer submit wins
      // whether it arrived while this write was in flight or after the failure settled.
      if (
        action !== "clear" &&
        !disposed &&
        latestSubmission === entry.submission &&
        pending === null
      ) {
        pending = entry
      }
      throw error
    })
    // A rejected write must not poison later generations. Once the latest attempt has settled,
    // idle flushes may use its recovered tail; callers that already captured `observed` still see
    // the real result. The identity guard prevents an older attempt from masking a newer one.
    const recovered = observed.catch(() => undefined)
    serializationTail = recovered
    latestSettlement = observed
    void observed.then(
      () => {
        if (latestSettlement === observed) latestSettlement = recovered
      },
      () => {
        if (latestSettlement === observed) latestSettlement = recovered
      },
    )
    return observed
  }

  function flush(): Promise<void> {
    clearTimer()
    const entry = pending
    pending = null
    return entry ? enqueue(entry) : latestSettlement
  }

  return Object.freeze({
    submit(item: WorkspaceTextDraftCommit<TContext>): void {
      if (disposed) return
      latestSubmission += 1
      pending = { item, submission: latestSubmission }
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        void flush().catch(() => {})
      }, options.debounceMs)
    },
    flush,
    dispose(flushPending = true): Promise<void> {
      if (disposed) return serializationTail
      const settled = flushPending ? flush() : serializationTail
      if (!flushPending) {
        clearTimer()
        pending = null
      }
      disposed = true
      return settled.catch(() => undefined)
    },
  })
}

export type WorkspaceTextDraftState = Readonly<{
  workspaceId: string
  value: string
  generation: number
  acknowledgedGeneration: number
  dirty: boolean
  observedSourceValue: string
  observedSourceVersion: string
  awaitingSourceValue: string | null
  sourceAtAcknowledgement: string | null
  sourceVersionAtAcknowledgement: string | null
}>

export type WorkspaceTextDraftOperationToken = Readonly<{
  workspaceId: string
  generation: number
}>

export function workspaceTextDraftOperationToken(
  state: Pick<WorkspaceTextDraftState, "workspaceId" | "generation">,
): WorkspaceTextDraftOperationToken {
  return Object.freeze({ workspaceId: state.workspaceId, generation: state.generation })
}

export function isWorkspaceTextDraftOperationCurrent(
  state: Pick<WorkspaceTextDraftState, "workspaceId" | "generation">,
  token: WorkspaceTextDraftOperationToken,
): boolean {
  return state.workspaceId === token.workspaceId && state.generation === token.generation
}

export function reconcileWorkspaceTextDraft(
  current: WorkspaceTextDraftState,
  workspaceId: string,
  sourceValue: string,
  sourceVersion: string,
): WorkspaceTextDraftState {
  if (current.workspaceId !== workspaceId) {
    return {
      workspaceId,
      value: sourceValue,
      generation: 0,
      acknowledgedGeneration: 0,
      dirty: false,
      observedSourceValue: sourceValue,
      observedSourceVersion: sourceVersion,
      awaitingSourceValue: null,
      sourceAtAcknowledgement: null,
      sourceVersionAtAcknowledgement: null,
    }
  }
  const sourceChanged =
    current.observedSourceValue !== sourceValue || current.observedSourceVersion !== sourceVersion
  const observed = sourceChanged
    ? { ...current, observedSourceValue: sourceValue, observedSourceVersion: sourceVersion }
    : current
  if (current.awaitingSourceValue !== null) {
    if (sourceValue === current.awaitingSourceValue) {
      return {
        ...observed,
        value: current.awaitingSourceValue,
        dirty: false,
        awaitingSourceValue: null,
        sourceAtAcknowledgement: null,
        sourceVersionAtAcknowledgement: null,
      }
    }
    // The source visible when commit settled can still be the pre-commit render. Wait for one
    // actual value-or-revision transition; if it is not our ack, that newer remote state wins.
    const transitionedSinceAcknowledgement =
      sourceChanged &&
      (sourceValue !== current.sourceAtAcknowledgement ||
        sourceVersion !== current.sourceVersionAtAcknowledgement)
    return transitionedSinceAcknowledgement
      ? {
          ...observed,
          value: sourceValue,
          dirty: false,
          awaitingSourceValue: null,
          sourceAtAcknowledgement: null,
          sourceVersionAtAcknowledgement: null,
        }
      : observed
  }
  if (current.dirty) {
    return observed
  }
  return observed.value === sourceValue ? observed : { ...observed, value: sourceValue }
}

export function adoptWorkspaceTextDraftIfCurrent(
  current: WorkspaceTextDraftState,
  token: WorkspaceTextDraftOperationToken,
  value: string,
): WorkspaceTextDraftState {
  if (!isWorkspaceTextDraftOperationCurrent(current, token)) return current
  const sourceAlreadyMatches = current.observedSourceValue === value
  return {
    ...current,
    value,
    acknowledgedGeneration: current.generation,
    dirty: false,
    awaitingSourceValue: sourceAlreadyMatches ? null : value,
    sourceAtAcknowledgement: sourceAlreadyMatches ? null : current.observedSourceValue,
    sourceVersionAtAcknowledgement: sourceAlreadyMatches ? null : current.observedSourceVersion,
  }
}

type UseWorkspaceTextDraftOptions<TContext> = Readonly<{
  workspaceId: string
  sourceValue: string
  sourceVersion: string
  context: TContext
  debounceMs?: number
  commit(workspaceId: string, value: string, context: TContext): Promise<string>
  onError?(error: unknown): WorkspaceTextDraftErrorAction | void
}>

let nextWorkspaceTextDraftGeneration = 0

function allocateWorkspaceTextDraftGeneration(): number {
  nextWorkspaceTextDraftGeneration += 1
  return nextWorkspaceTextDraftGeneration
}

/**
 * Keeps keystrokes local until durable persistence catches up. Source refreshes can update a clean
 * field, but cannot replace a dirty generation; an acknowledgement becomes clean only after the
 * external-store snapshot contains the exact committed value.
 */
export function useWorkspaceTextDraft<TContext>(options: UseWorkspaceTextDraftOptions<TContext>) {
  const [state, setState] = React.useState<WorkspaceTextDraftState>(() => ({
    workspaceId: options.workspaceId,
    value: options.sourceValue,
    generation: 0,
    acknowledgedGeneration: 0,
    dirty: false,
    observedSourceValue: options.sourceValue,
    observedSourceVersion: options.sourceVersion,
    awaitingSourceValue: null,
    sourceAtAcknowledgement: null,
    sourceVersionAtAcknowledgement: null,
  }))
  // Commit callbacks receive every volatile value explicitly. Keeping their initial identity lets
  // the queue survive source-store renders without flushing the debounce window on each keystroke.
  const [commit] = React.useState(() => options.commit)
  const [onError] = React.useState(() => options.onError)
  const [queue] = React.useState(() =>
    createSerializedDraftCommitQueue<TContext, string>({
      debounceMs: options.debounceMs ?? 160,
      commit: (item) => commit(item.workspaceId, item.value, item.context),
      onSuccess(item, committedValue) {
        setState((current) => {
          if (current.workspaceId !== item.workspaceId || item.generation > current.generation) {
            return current
          }
          const latestGeneration = item.generation === current.generation
          const sourceAlreadyMatches = current.observedSourceValue === committedValue
          return {
            ...current,
            acknowledgedGeneration: Math.max(current.acknowledgedGeneration, item.generation),
            ...(latestGeneration
              ? {
                  value: committedValue,
                  dirty: false,
                  awaitingSourceValue: sourceAlreadyMatches ? null : committedValue,
                  sourceAtAcknowledgement: sourceAlreadyMatches
                    ? null
                    : current.observedSourceValue,
                  sourceVersionAtAcknowledgement: sourceAlreadyMatches
                    ? null
                    : current.observedSourceVersion,
                }
              : {}),
          }
        })
      },
      onError(item, error) {
        const action = onError?.(error)
        if (action !== "clear") return "keep"
        setState((current) => {
          if (current.workspaceId !== item.workspaceId || current.generation !== item.generation) {
            return current
          }
          return {
            ...current,
            value: "",
            acknowledgedGeneration: current.generation,
            dirty: false,
            awaitingSourceValue: "",
            sourceAtAcknowledgement: current.observedSourceValue,
            sourceVersionAtAcknowledgement: current.observedSourceVersion,
          }
        })
        return "clear"
      },
    }),
  )

  React.useEffect(() => {
    setState((current) =>
      reconcileWorkspaceTextDraft(
        current,
        options.workspaceId,
        options.sourceValue,
        options.sourceVersion,
      ),
    )
  }, [
    options.sourceValue,
    options.sourceVersion,
    options.workspaceId,
    state.acknowledgedGeneration,
    state.awaitingSourceValue,
    state.dirty,
    state.generation,
    state.sourceAtAcknowledgement,
    state.sourceVersionAtAcknowledgement,
  ])

  const visibleState =
    state.workspaceId === options.workspaceId
      ? state
      : reconcileWorkspaceTextDraft(
          state,
          options.workspaceId,
          options.sourceValue,
          options.sourceVersion,
        )
  const currentOperationRef = React.useRef<WorkspaceTextDraftOperationToken>(
    workspaceTextDraftOperationToken(visibleState),
  )
  const visibleWorkspaceId = visibleState.workspaceId
  const visibleGeneration = visibleState.generation
  React.useLayoutEffect(() => {
    const current = currentOperationRef.current
    if (current.workspaceId !== visibleWorkspaceId || current.generation <= visibleGeneration) {
      currentOperationRef.current = {
        workspaceId: visibleWorkspaceId,
        generation: visibleGeneration,
      }
    }
    return () => {
      currentOperationRef.current = { workspaceId: "", generation: -1 }
    }
  }, [visibleGeneration, visibleWorkspaceId])

  // A component reused for another workspace must not carry its old pending text into the new id.
  React.useEffect(
    () => () => {
      void queue.flush().catch(() => {})
    },
    [options.workspaceId, queue],
  )

  const setValue = React.useCallback(
    (value: string) => {
      const generation = allocateWorkspaceTextDraftGeneration()
      currentOperationRef.current = { workspaceId: options.workspaceId, generation }
      setState((current) => ({
        ...reconcileWorkspaceTextDraft(
          current,
          options.workspaceId,
          options.sourceValue,
          options.sourceVersion,
        ),
        value,
        generation,
        dirty: true,
        awaitingSourceValue: null,
        sourceAtAcknowledgement: null,
        sourceVersionAtAcknowledgement: null,
      }))
      queue.submit({
        workspaceId: options.workspaceId,
        generation,
        value,
        context: options.context,
      })
    },
    [options.context, options.sourceValue, options.sourceVersion, options.workspaceId, queue],
  )

  const captureOperationToken = React.useCallback(
    () => workspaceTextDraftOperationToken(currentOperationRef.current),
    [],
  )
  const isOperationCurrent = React.useCallback(
    (token: WorkspaceTextDraftOperationToken) =>
      isWorkspaceTextDraftOperationCurrent(currentOperationRef.current, token),
    [],
  )
  const adoptIfCurrent = React.useCallback(
    (token: WorkspaceTextDraftOperationToken, value: string): boolean => {
      if (!isWorkspaceTextDraftOperationCurrent(currentOperationRef.current, token)) return false
      setState((current) => adoptWorkspaceTextDraftIfCurrent(current, token, value))
      return true
    },
    [],
  )
  const flush = React.useCallback(() => queue.flush(), [queue])

  return {
    value: visibleState.value,
    dirty: visibleState.dirty,
    setValue,
    captureOperationToken,
    isOperationCurrent,
    adoptIfCurrent,
    flush,
  }
}
