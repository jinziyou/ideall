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
  | "edit"
  | "delete"
  | "restore"
  | "move"
  | "read-blob"
  | "save-to-mine"
  | "navigate"

export type ResourceAction = {
  id: ResourceActionId
  label: string
  destructive?: boolean
  requires?: ResourceCapability[]
}

export type VfsActor = "ui" | "agent" | "embed"

export type VfsAccessContext = {
  actor: VfsActor
  permissions: readonly string[]
  activeRef?: ResourceRef
  intent?: "metadata" | "content" | "blob" | "action"
}

export type WatchHandle = { dispose: () => void }

export type VfsProvider = {
  scheme: ResourceScheme
  list(query: ResourceQuery, ctx: VfsAccessContext): Promise<ResourcePage>
  get(ref: ResourceRef, ctx: VfsAccessContext): Promise<ResourceRecord | null>
  actions(ref: ResourceRef, ctx: VfsAccessContext): Promise<ResourceAction[]>
  invoke(
    ref: ResourceRef,
    action: ResourceActionId,
    input: unknown,
    ctx: VfsAccessContext,
  ): Promise<unknown>
  watch?(query: ResourceQuery, ctx: VfsAccessContext, notify: () => void): WatchHandle | null
}

export type VfsErrorCode =
  | "not-found"
  | "permission-denied"
  | "consent-required"
  | "offline"
  | "unsupported"

export class VfsError extends Error {
  code: VfsErrorCode

  constructor(code: VfsErrorCode, message: string) {
    super(message)
    this.name = "VfsError"
    this.code = code
  }
}
