import type { FileRef, IdeallFile } from "@protocol/file-system"
import { invokeFileAction, readFile, writeFile } from "@/filesystem/registry"
import {
  FileSystemError,
  type FileActionInvokeOptions,
  type FileReadResult,
  type FileSystemAccessContext,
  type FileWriteInput,
} from "@/filesystem/types"

const UI_CONTENT_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "content",
} as const satisfies FileSystemAccessContext

const UI_WRITE_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "write",
} as const satisfies FileSystemAccessContext

const UI_ACTION_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "action",
} as const satisfies FileSystemAccessContext

export type FileDocumentSnapshot<T> = Readonly<{
  data: T
  mediaType: string
  size?: number
  version?: string
  /** write 已提交但规范化正文暂时无法回读；下次写前必须先 refresh。 */
  stale?: boolean
  refreshError?: unknown
}>

export type FileDocumentGateway = Readonly<{
  read(ref: FileRef): Promise<FileReadResult>
  write(ref: FileRef, input: FileWriteInput): Promise<IdeallFile>
  invoke(
    ref: FileRef,
    action: string,
    input: unknown,
    options?: FileActionInvokeOptions,
  ): Promise<unknown>
}>

export const registryFileDocumentGateway: FileDocumentGateway = {
  read: (ref) => readFile(ref, UI_CONTENT_CONTEXT, { encoding: "json" }),
  write: (ref, input) => writeFile(ref, input, UI_WRITE_CONTEXT),
  invoke: (ref, action, input, options) =>
    invokeFileAction(ref, action, input, UI_ACTION_CONTEXT, options),
}

function decodeSnapshot<T>(result: FileReadResult, decode: (value: unknown) => T) {
  return {
    data: decode(result.data),
    mediaType: result.mediaType,
    ...(result.size === undefined ? {} : { size: result.size }),
    ...(result.version === undefined ? {} : { version: result.version }),
  } satisfies FileDocumentSnapshot<T>
}

export async function readFileDocument<T>(
  gateway: FileDocumentGateway,
  ref: FileRef,
  decode: (value: unknown) => T,
): Promise<FileDocumentSnapshot<T>> {
  return decodeSnapshot(await gateway.read(ref), decode)
}

/**
 * 带一次字段级重放的 CAS 写。冲突时先读取新版本，再把调用方的 updater 应用到新文档；
 * 第二次冲突继续显式抛出，避免在持续竞争下静默覆盖其它 Display 的修改。
 */
export async function updateFileDocument<T>(
  gateway: FileDocumentGateway,
  ref: FileRef,
  current: FileDocumentSnapshot<T>,
  updater: (value: T) => T,
  decode: (value: unknown) => T,
): Promise<FileDocumentSnapshot<T>> {
  let base = current
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const next = updater(base.data)
    let written: IdeallFile
    try {
      written = await gateway.write(ref, {
        data: next,
        mediaType: base.mediaType,
        ...(base.version === undefined ? {} : { expectedVersion: base.version }),
      })
    } catch (error) {
      if (!(error instanceof FileSystemError) || error.code !== "conflict" || attempt > 0) {
        throw error
      }
      base = await readFileDocument(gateway, ref, decode)
      continue
    }

    try {
      return await readFileDocument(gateway, ref, decode)
    } catch (refreshError) {
      // write 已提交，不能把回读故障伪装成写失败。保留 provider 返回的新版本供 UI 展示，
      // 但标记 stale；FileDocumentClient 会在下一次写前强制重新读取规范化正文。
      return {
        data: next,
        mediaType: written.mediaType || base.mediaType,
        ...(written.size === undefined ? {} : { size: written.size }),
        ...(written.version === undefined ? {} : { version: written.version }),
        stale: true,
        refreshError,
      }
    }
  }
  return base
}

export type FileDocumentActionResult<T, R> = Readonly<{
  result: R
  /** 动作已经提交后，公开正文刷新仍可能暂时失败；这不能反转动作结果。 */
  snapshot: FileDocumentSnapshot<T> | null
  refreshError: unknown | null
}>

/**
 * 一个 Display 对一个 FileRef 的所有读写/动作共用同一队列。快速输入不会乱序提交，watch
 * 刷新也可排在 mutation 后读取最终版本。
 */
export class FileDocumentClient<T> {
  readonly #gateway: FileDocumentGateway
  readonly #ref: FileRef
  readonly #decode: (value: unknown) => T
  #snapshot: FileDocumentSnapshot<T> | null = null
  #tail: Promise<void> = Promise.resolve()

  constructor(
    ref: FileRef,
    decode: (value: unknown) => T,
    gateway: FileDocumentGateway = registryFileDocumentGateway,
  ) {
    this.#ref = ref
    this.#decode = decode
    this.#gateway = gateway
  }

  snapshot(): FileDocumentSnapshot<T> | null {
    return this.#snapshot
  }

  refresh(): Promise<FileDocumentSnapshot<T>> {
    return this.#enqueue(async () => {
      const snapshot = await readFileDocument(this.#gateway, this.#ref, this.#decode)
      this.#snapshot = snapshot
      return snapshot
    })
  }

  update(updater: (value: T) => T): Promise<FileDocumentSnapshot<T>> {
    return this.#enqueue(async () => {
      const current =
        this.#snapshot && !this.#snapshot.stale
          ? this.#snapshot
          : await readFileDocument(this.#gateway, this.#ref, this.#decode)
      const snapshot = await updateFileDocument(
        this.#gateway,
        this.#ref,
        current,
        updater,
        this.#decode,
      )
      this.#snapshot = snapshot
      return snapshot
    })
  }

  invoke<R = unknown>(action: string, input?: unknown): Promise<FileDocumentActionResult<T, R>> {
    return this.#enqueue(async () => {
      const current = this.#snapshot
      const options: FileActionInvokeOptions | undefined = current
        ? { expectedVersion: current.version ?? null }
        : undefined
      const result = (await this.#gateway.invoke(this.#ref, action, input, options)) as R
      try {
        const snapshot = await readFileDocument(this.#gateway, this.#ref, this.#decode)
        this.#snapshot = snapshot
        return { result, snapshot, refreshError: null }
      } catch (refreshError) {
        // invoke 已经成功；把 refresh 失败继续当成 action 失败会诱导调用方重试非幂等动作。
        // 同时清除旧版本，确保下一次写入会先重新读取，而不是拿动作前的版本继续 CAS。
        this.#snapshot = null
        return { result, snapshot: null, refreshError }
      }
    })
  }

  #enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const pending = this.#tail.then(operation, operation)
    this.#tail = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }
}
