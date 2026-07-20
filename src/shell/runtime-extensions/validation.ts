import { validateEngineDescriptor } from "@/engines/registry"
import type {
  RuntimeExtensionContribution,
  RuntimeExtensionDescriptor,
  RuntimeExtensionDisposeReason,
  RuntimeExtensionFactory,
  RuntimeExtensionSource,
} from "./types"

export const MAX_EXTENSION_ID_LENGTH = 128
export const MAX_LABEL_LENGTH = 160
export const MAX_DIGEST_LENGTH = 512
export const MAX_RECEIPT_LENGTH = 1024
const MAX_PERMISSIONS = 64
const MAX_PERMISSION_LENGTH = 128

export function isDisposeReason(value: unknown): value is RuntimeExtensionDisposeReason {
  return (
    value === "uninstall" ||
    value === "revoke" ||
    value === "factory-removed" ||
    value === "activation-rollback"
  )
}

export function validExtensionId(id: string): boolean {
  return id.length <= MAX_EXTENSION_ID_LENGTH && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(id)
}

export function validBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function validPermission(permission: unknown): permission is string {
  return (
    validBoundedText(permission, MAX_PERMISSION_LENGTH) &&
    /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(permission)
  )
}

export function validateFactory(
  factory: RuntimeExtensionFactory,
  expectedKind: RuntimeExtensionSource["kind"],
): void {
  if (
    !validExtensionId(factory.id) ||
    !validBoundedText(factory.label, MAX_LABEL_LENGTH) ||
    !Number.isSafeInteger(factory.version) ||
    factory.version < 1 ||
    factory.source.kind !== expectedKind ||
    !validBoundedText(factory.source.id, MAX_EXTENSION_ID_LENGTH) ||
    !validBoundedText(factory.digest, MAX_DIGEST_LENGTH) ||
    !validBoundedText(factory.permissionDigest, MAX_DIGEST_LENGTH) ||
    !Array.isArray(factory.permissions) ||
    factory.permissions.length > MAX_PERMISSIONS ||
    factory.permissions.some((permission) => !validPermission(permission)) ||
    new Set(factory.permissions).size !== factory.permissions.length ||
    typeof factory.create !== "function"
  ) {
    throw new TypeError(`Invalid runtime extension factory: ${factory.id}`)
  }
  if (
    factory.source.kind === "package" &&
    factory.source.location !== undefined &&
    !validBoundedText(factory.source.location, MAX_DIGEST_LENGTH)
  ) {
    throw new TypeError(`Invalid runtime extension package location: ${factory.id}`)
  }
}

export function descriptorFor(factory: RuntimeExtensionFactory): RuntimeExtensionDescriptor {
  return Object.freeze({
    id: factory.id,
    label: factory.label,
    version: factory.version,
    source: Object.freeze({ ...factory.source }),
    digest: factory.digest,
    permissionDigest: factory.permissionDigest,
    permissions: Object.freeze([...factory.permissions]),
  })
}

export function snapshotFactory(factory: RuntimeExtensionFactory): RuntimeExtensionFactory {
  const descriptor = descriptorFor(factory)
  const create = factory.create
  return Object.freeze({
    ...descriptor,
    create,
  })
}

export function validateContribution(extension: RuntimeExtensionContribution): void {
  if (!validExtensionId(extension.id)) {
    throw new TypeError(`Invalid runtime extension id: ${extension.id}`)
  }
  if (!validBoundedText(extension.label, MAX_LABEL_LENGTH)) {
    throw new TypeError("Runtime extension label cannot be empty")
  }

  const fileSystemIds = new Set<string>()
  const mountIds = new Set<string>()
  for (const { provider, mount } of extension.fileSystems ?? []) {
    const fileSystemId = provider.descriptor.fileSystemId
    if (fileSystemIds.has(fileSystemId)) {
      throw new TypeError(`Duplicate file system in extension ${extension.id}: ${fileSystemId}`)
    }
    if (mountIds.has(mount.entryId)) {
      throw new TypeError(`Duplicate mount in extension ${extension.id}: ${mount.entryId}`)
    }
    fileSystemIds.add(fileSystemId)
    mountIds.add(mount.entryId)
  }

  const engineIds = new Set<string>()
  for (const { descriptor, renderer } of extension.engines ?? []) {
    validateEngineDescriptor(descriptor)
    if (typeof renderer !== "function") {
      throw new TypeError(`Invalid runtime extension renderer: ${descriptor.engineId}`)
    }
    if (engineIds.has(descriptor.engineId)) {
      throw new TypeError(`Duplicate engine in extension ${extension.id}: ${descriptor.engineId}`)
    }
    engineIds.add(descriptor.engineId)
  }
  if (extension.activate !== undefined && typeof extension.activate !== "function") {
    throw new TypeError(`Invalid activation callback: ${extension.id}`)
  }
  if (extension.dispose !== undefined && typeof extension.dispose !== "function") {
    throw new TypeError(`Invalid disposal callback: ${extension.id}`)
  }
}

export function aggregateFailure(message: string, failures: readonly unknown[]): AggregateError {
  return new AggregateError([...failures], message)
}
