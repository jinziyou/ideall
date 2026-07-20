"use client"

import * as React from "react"
import type { FileRef } from "@protocol/file-system"
import { getFileSystemRevision, subscribeFileSystems, watchFile } from "@/filesystem/registry"
import type { FileSystemAccessContext } from "@/filesystem/types"
import {
  FileDocumentClient,
  type FileDocumentActionResult,
  type FileDocumentSnapshot,
} from "./file-document"

const UI_WATCH_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "watch",
} as const satisfies FileSystemAccessContext

const SERVER_REGISTRY_REVISION = 0

type FileDocumentGeneration<T> = {
  readonly client: FileDocumentClient<T>
  pendingMutations: number
  pendingWrites: number
  pendingActions: number
  mutationSequence: number
}

export type FileDocumentState<T> = Readonly<{
  data: T | null
  version?: string
  mediaType?: string
  loading: boolean
  saving: boolean
  acting: boolean
  error: unknown | null
}>

export type FileDocumentBinding<T> = FileDocumentState<T> &
  Readonly<{
    refresh(): Promise<FileDocumentSnapshot<T>>
    update(updater: (value: T) => T): Promise<FileDocumentSnapshot<T>>
    invoke<R = unknown>(action: string, input?: unknown): Promise<R>
    clearError(): void
  }>

function stateFromSnapshot<T>(
  snapshot: FileDocumentSnapshot<T>,
  previous: FileDocumentState<T>,
): FileDocumentState<T> {
  return {
    data: snapshot.data,
    version: snapshot.version,
    mediaType: snapshot.mediaType,
    loading: false,
    saving: previous.saving,
    acting: previous.acting,
    error: snapshot.refreshError ?? null,
  }
}

/**
 * Built-in Display 的 JSON 文件绑定：只经 FileSystem registry 读取、CAS 写入、invoke 与 watch。
 * provider 卸载/替换会随 registry revision 自动重连；旧异步结果不能覆盖新 generation。
 */
export function useFileDocument<T>(
  ref: FileRef,
  decode: (value: unknown) => T,
): FileDocumentBinding<T> {
  const { fileSystemId, fileId } = ref
  const decoderRef = React.useRef(decode)
  const stableRef = React.useMemo<FileRef>(() => ({ fileSystemId, fileId }), [fileId, fileSystemId])
  const client = React.useMemo(
    () => new FileDocumentClient(stableRef, (value) => decoderRef.current(value)),
    [stableRef],
  )
  const generation = React.useMemo<FileDocumentGeneration<T>>(
    () => ({
      client,
      pendingMutations: 0,
      pendingWrites: 0,
      pendingActions: 0,
      mutationSequence: 0,
    }),
    [client],
  )
  const committedGenerationRef = React.useRef(generation)
  const [state, setState] = React.useState<FileDocumentState<T>>({
    data: null,
    loading: true,
    saving: false,
    acting: false,
    error: null,
  })
  const mountedRef = React.useRef(false)
  const lifecycleRef = React.useRef(0)
  const registryRevision = React.useSyncExternalStore(
    subscribeFileSystems,
    getFileSystemRevision,
    () => SERVER_REGISTRY_REVISION,
  )

  // render 阶段不改共享 ref：并发渲染若被放弃，已提交 generation 仍可正常收口。
  // 身份切换在浏览器绘制前清空旧文件正文，防止跨文件闪现；decoder 同步到已提交 render。
  React.useLayoutEffect(() => {
    decoderRef.current = decode
    if (committedGenerationRef.current === generation) return
    committedGenerationRef.current = generation
    setState({ data: null, loading: true, saving: false, acting: false, error: null })
  }, [decode, generation])

  const commit = React.useCallback(
    (snapshot: FileDocumentSnapshot<T>) => {
      if (
        !mountedRef.current ||
        committedGenerationRef.current !== generation ||
        generation.pendingMutations > 0
      ) {
        return
      }
      setState((previous) => stateFromSnapshot(snapshot, previous))
    },
    [generation],
  )

  const refresh = React.useCallback(async () => {
    const lifecycle = lifecycleRef.current
    try {
      const snapshot = await client.refresh()
      if (lifecycle === lifecycleRef.current) commit(snapshot)
      return snapshot
    } catch (error) {
      if (
        mountedRef.current &&
        lifecycle === lifecycleRef.current &&
        committedGenerationRef.current === generation
      ) {
        setState((previous) => ({ ...previous, loading: false, error }))
      }
      throw error
    }
  }, [client, commit, generation])

  React.useEffect(() => {
    mountedRef.current = true
    const lifecycle = ++lifecycleRef.current
    setState((previous) => ({ ...previous, loading: true, error: null }))
    void refresh().catch(() => {})

    let watch: ReturnType<typeof watchFile> = null
    try {
      watch = watchFile(stableRef, UI_WATCH_CONTEXT, () => {
        if (lifecycle === lifecycleRef.current) void refresh().catch(() => {})
      })
    } catch {
      // provider 尚未挂载时由 registry revision 重试；不支持 watch 仍保留显式刷新能力。
    }

    return () => {
      if (lifecycle === lifecycleRef.current) lifecycleRef.current += 1
      mountedRef.current = false
      watch?.dispose()
    }
  }, [client, refresh, registryRevision, stableRef])

  const update = React.useCallback(
    async (updater: (value: T) => T) => {
      const mutation = ++generation.mutationSequence
      generation.pendingMutations += 1
      generation.pendingWrites += 1
      if (committedGenerationRef.current === generation) {
        setState((previous) =>
          committedGenerationRef.current === generation
            ? {
                ...previous,
                data: previous.data === null ? null : updater(previous.data),
                saving: true,
                error: null,
              }
            : previous,
        )
      }
      try {
        const snapshot = await client.update(updater)
        generation.pendingMutations -= 1
        generation.pendingWrites -= 1
        const isCurrentGeneration = committedGenerationRef.current === generation
        if (mountedRef.current && isCurrentGeneration && mutation === generation.mutationSequence) {
          setState((previous) => ({
            ...stateFromSnapshot(snapshot, previous),
            saving: generation.pendingWrites > 0,
          }))
        } else if (mountedRef.current && isCurrentGeneration) {
          setState((previous) => ({ ...previous, saving: generation.pendingWrites > 0 }))
        }
        return snapshot
      } catch (error) {
        generation.pendingMutations -= 1
        generation.pendingWrites -= 1
        const snapshot = await client.refresh().catch(() => null)
        const isCurrentGeneration = committedGenerationRef.current === generation
        if (mountedRef.current && isCurrentGeneration && mutation === generation.mutationSequence) {
          setState((previous) => ({
            ...(snapshot ? stateFromSnapshot(snapshot, previous) : previous),
            saving: generation.pendingWrites > 0,
            error,
          }))
        } else if (mountedRef.current && isCurrentGeneration) {
          setState((previous) => ({ ...previous, saving: generation.pendingWrites > 0 }))
        }
        throw error
      }
    },
    [client, generation],
  )

  const invoke = React.useCallback(
    async <R>(action: string, input?: unknown): Promise<R> => {
      const mutation = ++generation.mutationSequence
      generation.pendingMutations += 1
      generation.pendingActions += 1
      if (committedGenerationRef.current === generation) {
        setState((previous) => ({ ...previous, acting: true, error: null }))
      }
      try {
        const outcome: FileDocumentActionResult<T, R> = await client.invoke<R>(action, input)
        generation.pendingMutations -= 1
        generation.pendingActions -= 1
        const isCurrentGeneration = committedGenerationRef.current === generation
        if (mountedRef.current && isCurrentGeneration && mutation === generation.mutationSequence) {
          setState((previous) =>
            outcome.snapshot
              ? {
                  ...stateFromSnapshot(outcome.snapshot, previous),
                  acting: generation.pendingActions > 0,
                  error: outcome.refreshError,
                }
              : {
                  ...previous,
                  acting: generation.pendingActions > 0,
                  error: outcome.refreshError,
                },
          )
        } else if (mountedRef.current && isCurrentGeneration) {
          setState((previous) => ({ ...previous, acting: generation.pendingActions > 0 }))
        }
        return outcome.result
      } catch (error) {
        generation.pendingMutations -= 1
        generation.pendingActions -= 1
        const isCurrentGeneration = committedGenerationRef.current === generation
        if (mountedRef.current && isCurrentGeneration && mutation === generation.mutationSequence) {
          setState((previous) => ({
            ...previous,
            acting: generation.pendingActions > 0,
            error,
          }))
        } else if (mountedRef.current && isCurrentGeneration) {
          setState((previous) => ({ ...previous, acting: generation.pendingActions > 0 }))
        }
        throw error
      }
    },
    [client, generation],
  )

  const clearError = React.useCallback(() => {
    setState((previous) => ({ ...previous, error: null }))
  }, [])

  return { ...state, refresh, update, invoke, clearError }
}
