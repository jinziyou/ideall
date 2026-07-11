import type {
  ResourceCapability,
  ResourceMeta,
  ResourceRecord,
  ResourceRef,
  ResourceScheme,
} from "@protocol/resource"

export type { ResourceCapability, ResourceMeta, ResourceRecord, ResourceRef, ResourceScheme }

export type ResourceQuery = {
  scheme: ResourceScheme
  /** 精确监听单个资源时使用；list 查询通常不设置。 */
  id?: string
  kind?: string
  kinds?: readonly string[]
  parent?: ResourceRef
  text?: string
  limit?: number
  cursor?: string
}

export type ResourcePage = {
  items: ResourceMeta[]
  nextCursor?: string
}

export type ResourceActionId =
  | "open"
  | "preview"
  | "create"
  | "edit"
  | "delete"
  | "restore"
  | "move"
  | "read-blob"
  | "write-blob"
  | "save-to-mine"
  | "navigate"

export type ResourceAction = {
  id: ResourceActionId
  label: string
  destructive?: boolean
  requires?: ResourceCapability[]
  invocation?: "display" | "parameterless"
}

export type ResourceSourceActor = "ui" | "agent" | "embed"

export type ResourceSourceAccessContext = {
  actor: ResourceSourceActor
  permissions: readonly string[]
  activeRef?: ResourceRef
  intent?: "metadata" | "content" | "blob" | "action"
}

export type WatchHandle = { dispose: () => void }

export type ResourceSourceProvider = {
  scheme: ResourceScheme
  list(query: ResourceQuery, ctx: ResourceSourceAccessContext): Promise<ResourcePage>
  get(ref: ResourceRef, ctx: ResourceSourceAccessContext): Promise<ResourceRecord | null>
  /** 结果与 refs 一一对应且保持顺序；未知资源为 null，其它授权/离线错误继续抛出。 */
  getMany?(
    refs: readonly ResourceRef[],
    ctx: ResourceSourceAccessContext,
  ): Promise<Array<ResourceRecord | null>>
  create?(input: unknown, ctx: ResourceSourceAccessContext): Promise<ResourceRecord>
  actions(ref: ResourceRef, ctx: ResourceSourceAccessContext): Promise<ResourceAction[]>
  invoke(
    ref: ResourceRef,
    action: ResourceActionId,
    input: unknown,
    ctx: ResourceSourceAccessContext,
  ): Promise<unknown>
  watch?(
    query: ResourceQuery,
    ctx: ResourceSourceAccessContext,
    notify: () => void,
  ): WatchHandle | null
}

export type ResourceSourceErrorCode =
  | "not-found"
  | "permission-denied"
  | "consent-required"
  | "offline"
  | "unsupported"

export class ResourceSourceError extends Error {
  code: ResourceSourceErrorCode

  constructor(code: ResourceSourceErrorCode, message: string) {
    super(message)
    this.name = "ResourceSourceError"
    this.code = code
  }
}
