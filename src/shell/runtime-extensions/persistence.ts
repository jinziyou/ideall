import type {
  RuntimeExtensionConsentBinding,
  RuntimeExtensionConsentReceipt,
  RuntimeExtensionDescriptor,
  RuntimeExtensionVerificationReceipt,
} from "./types"
import {
  MAX_DIGEST_LENGTH,
  MAX_EXTENSION_ID_LENGTH,
  MAX_RECEIPT_LENGTH,
  validBoundedText,
  validExtensionId,
} from "./validation"

export const RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY = "ideall:runtime-extensions:v2"

const SNAPSHOT_VERSION = 2 as const
const MAX_SNAPSHOT_BYTES = 64 * 1024
const MAX_PERSISTED_EXTENSIONS = 64

export type RuntimeExtensionInstallRecord = Readonly<{
  id: string
  version: number
  digest: string
  permissionDigest: string
  consentReceipt: string
}>

type InstallSnapshot = Readonly<{
  version: typeof SNAPSHOT_VERSION
  records: readonly RuntimeExtensionInstallRecord[]
}>

export type ExtensionStorage = Pick<Storage, "getItem" | "setItem">

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseInstallRecord(value: unknown): RuntimeExtensionInstallRecord | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["id", "version", "digest", "permissionDigest", "consentReceipt"])
  ) {
    return null
  }
  if (
    typeof value.id !== "string" ||
    !validExtensionId(value.id) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1 ||
    !validBoundedText(value.digest, MAX_DIGEST_LENGTH) ||
    !validBoundedText(value.permissionDigest, MAX_DIGEST_LENGTH) ||
    !validBoundedText(value.consentReceipt, MAX_RECEIPT_LENGTH)
  ) {
    return null
  }
  return {
    id: value.id,
    version: value.version as number,
    digest: value.digest,
    permissionDigest: value.permissionDigest,
    consentReceipt: value.consentReceipt,
  }
}

export function parseInstallSnapshot(raw: string): InstallSnapshot | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_SNAPSHOT_BYTES) return null
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!isRecord(value) || !exactKeys(value, ["version", "records"])) return null
  if (value.version !== SNAPSHOT_VERSION || !Array.isArray(value.records)) return null
  if (value.records.length > MAX_PERSISTED_EXTENSIONS) return null
  const records = value.records.map(parseInstallRecord)
  if (records.some((record) => record === null)) return null
  const complete = records as RuntimeExtensionInstallRecord[]
  if (new Set(complete.map((record) => record.id)).size !== complete.length) return null
  return { version: SNAPSHOT_VERSION, records: complete }
}

export function serializeInstallSnapshot(
  records: readonly RuntimeExtensionInstallRecord[],
): string {
  if (records.length > MAX_PERSISTED_EXTENSIONS) {
    throw new Error("Too many runtime extension records")
  }
  const value = JSON.stringify({ version: SNAPSHOT_VERSION, records } satisfies InstallSnapshot)
  if (new TextEncoder().encode(value).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error("Runtime extension snapshot exceeds size limit")
  }
  return value
}

export function matchesDescriptor(
  record: RuntimeExtensionInstallRecord,
  descriptor: RuntimeExtensionDescriptor,
): boolean {
  return (
    record.id === descriptor.id &&
    record.version === descriptor.version &&
    record.digest === descriptor.digest &&
    record.permissionDigest === descriptor.permissionDigest
  )
}

function validVerificationReceipt(
  receipt: RuntimeExtensionVerificationReceipt | null,
  descriptor: RuntimeExtensionDescriptor,
): receipt is RuntimeExtensionVerificationReceipt {
  return Boolean(
    receipt &&
    validBoundedText(receipt.receiptId, MAX_RECEIPT_LENGTH) &&
    validBoundedText(receipt.verifierId, MAX_EXTENSION_ID_LENGTH) &&
    Number.isSafeInteger(receipt.verifiedAt) &&
    receipt.verifiedAt >= 0 &&
    receipt.id === descriptor.id &&
    receipt.version === descriptor.version &&
    receipt.digest === descriptor.digest &&
    receipt.permissionDigest === descriptor.permissionDigest,
  )
}

function snapshotVerificationReceipt(
  receipt: RuntimeExtensionVerificationReceipt,
): RuntimeExtensionVerificationReceipt {
  return Object.freeze({
    receiptId: receipt.receiptId,
    verifierId: receipt.verifierId,
    id: receipt.id,
    version: receipt.version,
    digest: receipt.digest,
    permissionDigest: receipt.permissionDigest,
    verifiedAt: receipt.verifiedAt,
  })
}

export function acceptedVerificationReceipt(
  candidate: RuntimeExtensionVerificationReceipt | null,
  descriptor: RuntimeExtensionDescriptor,
): RuntimeExtensionVerificationReceipt | null {
  try {
    if (!candidate) return null
    const receipt = snapshotVerificationReceipt(candidate)
    return validVerificationReceipt(receipt, descriptor) ? receipt : null
  } catch {
    return null
  }
}

export function validConsentReceipt(
  receipt: RuntimeExtensionConsentReceipt | null,
  descriptor: RuntimeExtensionConsentBinding,
): receipt is RuntimeExtensionConsentReceipt {
  return Boolean(
    receipt &&
    validBoundedText(receipt.receiptId, MAX_RECEIPT_LENGTH) &&
    Number.isSafeInteger(receipt.grantedAt) &&
    receipt.grantedAt >= 0 &&
    receipt.id === descriptor.id &&
    receipt.version === descriptor.version &&
    receipt.digest === descriptor.digest &&
    receipt.permissionDigest === descriptor.permissionDigest,
  )
}

function snapshotConsentReceipt(
  receipt: RuntimeExtensionConsentReceipt,
): RuntimeExtensionConsentReceipt {
  return Object.freeze({
    receiptId: receipt.receiptId,
    id: receipt.id,
    version: receipt.version,
    digest: receipt.digest,
    permissionDigest: receipt.permissionDigest,
    grantedAt: receipt.grantedAt,
  })
}

export function acceptedConsentReceipt(
  candidate: RuntimeExtensionConsentReceipt | null,
  descriptor: RuntimeExtensionDescriptor,
): RuntimeExtensionConsentReceipt | null {
  try {
    if (!candidate) return null
    const receipt = snapshotConsentReceipt(candidate)
    return validConsentReceipt(receipt, descriptor) ? receipt : null
  } catch {
    return null
  }
}

export function installRecord(
  descriptor: RuntimeExtensionDescriptor,
  consentReceipt: string,
): RuntimeExtensionInstallRecord {
  return {
    id: descriptor.id,
    version: descriptor.version,
    digest: descriptor.digest,
    permissionDigest: descriptor.permissionDigest,
    consentReceipt,
  }
}
