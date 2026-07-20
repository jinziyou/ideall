import { sameFileRef, type FileRef } from "@protocol/file-system"
import { CAPTURE_BOOKMARK_ACTION } from "@protocol/capture"
import type { ResourceMeta, ResourceRef, ResourceScheme } from "@protocol/resource"
import { getResourceSource } from "@/filesystem/resource-sources/registry"
import { ResourceSourceError } from "@/filesystem/resource-sources/types"
import { base64ToBytes, bytesToBase64 } from "@/lib/base64"
import type { FileReadOptions, FileSystemAccessContext } from "../types"
import { FileSystemError } from "../types"

export type PlaceResourceQuery = {
  scheme: ResourceScheme
  id?: string
  kinds?: readonly string[]
  rootOnly?: boolean
}

function isScopedEngineAccess(ref: FileRef, ctx: FileSystemAccessContext): boolean {
  return (
    ctx.actor === "engine" &&
    ctx.activeFile != null &&
    sameFileRef(ref, ctx.activeFile) &&
    (ctx.intent === "metadata" || ctx.intent === "content" || ctx.intent === "write")
  )
}

export function toResourceSourceContext(
  ctx: FileSystemAccessContext,
  target: FileRef | null,
  activeResource: ResourceRef | null,
  intent = ctx.intent,
) {
  const actor =
    ctx.actor === "ui" || (target != null && isScopedEngineAccess(target, ctx))
      ? ("ui" as const)
      : ctx.actor === "embed"
        ? ("embed" as const)
        : ("agent" as const)
  return {
    actor,
    permissions: ctx.permissions,
    activeRef: activeResource ?? undefined,
    intent:
      intent === "content" || intent === "write"
        ? ("content" as const)
        : intent === "action"
          ? ("action" as const)
          : ("metadata" as const),
  }
}

function hasPermission(ctx: FileSystemAccessContext, permission: string): boolean {
  return ctx.permissions.includes(permission)
}

function assertIntent(ctx: FileSystemAccessContext, intent: "write" | "action", ref: FileRef) {
  if (ctx.actor !== "ui" && ctx.intent !== intent) {
    throw new FileSystemError(
      "permission-denied",
      `The ${ctx.actor} actor requires ${intent} intent`,
      ref,
    )
  }
}

export function assertCanWrite(ref: FileRef, ctx: FileSystemAccessContext): void {
  assertIntent(ctx, "write", ref)
  if (
    ctx.actor === "ui" ||
    isScopedEngineAccess(ref, ctx) ||
    hasPermission(ctx, "fs:write") ||
    hasPermission(ctx, "fs.notes:write")
  ) {
    return
  }
  throw new FileSystemError("permission-denied", "Missing write permission", ref)
}

export function assertCanInvoke(ref: FileRef, action: string, ctx: FileSystemAccessContext): void {
  assertIntent(ctx, "action", ref)
  if (ctx.actor === "ui") return

  const activeEngine =
    ctx.actor === "engine" && ctx.activeFile != null && sameFileRef(ref, ctx.activeFile)
  if (["open", "preview", "navigate"].includes(action)) {
    if (activeEngine || hasPermission(ctx, "fs:read")) return
  } else if (action === "save-to-mine" || action === CAPTURE_BOOKMARK_ACTION) {
    if (
      hasPermission(ctx, "hub.bookmarks:write") ||
      hasPermission(ctx, "hub.subscriptions:write")
    ) {
      return
    }
  } else if (hasPermission(ctx, "fs:write") || hasPermission(ctx, "fs.notes:write")) {
    return
  }
  throw new FileSystemError("permission-denied", `Missing permission for action: ${action}`, ref)
}

export function assertCanListActions(ref: FileRef, ctx: FileSystemAccessContext): void {
  assertIntent(ctx, "action", ref)
  if (
    ctx.actor === "ui" ||
    (ctx.actor === "engine" && ctx.activeFile != null && sameFileRef(ref, ctx.activeFile)) ||
    hasPermission(ctx, "fs:read")
  ) {
    return
  }
  throw new FileSystemError("permission-denied", "Missing fs:read permission", ref)
}

export function versionForResource(meta: ResourceMeta): string | undefined {
  return meta.updatedAt == null ? undefined : String(meta.updatedAt)
}

export function assertExpectedVersion(
  ref: FileRef,
  expectedVersion: string | null | undefined,
  currentVersion: string | undefined,
): void {
  if (expectedVersion === undefined) return
  if (expectedVersion === (currentVersion ?? null)) return
  throw new FileSystemError(
    "conflict",
    `File version changed (expected ${expectedVersion ?? "no version"}, current ${currentVersion ?? "no version"})`,
    ref,
  )
}

function normalizeRange(
  ref: FileRef,
  range: NonNullable<FileReadOptions["range"]>,
): { start: number; end?: number } {
  const { start, end } = range
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    (end != null && (!Number.isSafeInteger(end) || end < start))
  ) {
    throw new FileSystemError("invalid-input", "Invalid read range", ref)
  }
  return { start, ...(end == null ? {} : { end }) }
}

export function rangeReadData(
  ref: FileRef,
  data: unknown,
  range: FileReadOptions["range"],
): { data: unknown; size?: number } {
  if (!range) return { data }
  const { start, end } = normalizeRange(ref, range)
  if (data instanceof Blob) {
    const blob = data.slice(start, end)
    return { data: blob, size: blob.size }
  }
  if (typeof data === "string") {
    const bytes = new TextEncoder().encode(data).slice(start, end)
    return { data: new TextDecoder().decode(bytes), size: bytes.byteLength }
  }
  if (data instanceof ArrayBuffer) {
    const value = data.slice(start, end)
    return { data: value, size: value.byteLength }
  }
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice(start, end)
    return { data: bytes, size: bytes.byteLength }
  }
  if (
    data != null &&
    typeof data === "object" &&
    "base64" in data &&
    typeof data.base64 === "string"
  ) {
    const bytes = base64ToBytes(data.base64).slice(start, end)
    return {
      data: { ...data, base64: bytesToBase64(bytes), size: bytes.byteLength },
      size: bytes.byteLength,
    }
  }
  throw new FileSystemError("unsupported", "Read ranges require byte-addressable content", ref)
}

export function queryCanWatch(query: PlaceResourceQuery): boolean {
  if (!getResourceSource(query.scheme)?.watch) return false
  if (query.scheme === "app" || query.scheme === "tool") return false
  return true
}

export function resourceCanWatch(ref: ResourceRef): boolean {
  return queryCanWatch({ scheme: ref.scheme, kinds: [ref.kind] })
}

export function rethrowFileSystemError(error: unknown, ref: FileRef): never {
  if (error instanceof ResourceSourceError) {
    const code = error.code === "unsupported" ? "unsupported" : error.code
    throw new FileSystemError(code, error.message, ref)
  }
  throw error
}
