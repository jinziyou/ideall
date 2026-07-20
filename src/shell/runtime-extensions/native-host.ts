import type { RuntimeExtensionVerificationReceipt } from "./types"
import { isTauri } from "@/lib/tauri"

export type NativeRuntimeExtensionPackage = Readonly<{
  id: string
  label: string
  version: number
  publisher: string
  publisherFingerprint: string
  permissions: readonly ("resources:read" | "tools:invoke")[]
  digest: string
  permissionDigest: string
  connectorProtocol: "mcp-stdio"
  rollbackVersion: number | null
}>

export type NativeRuntimeExtensionDiscoveryReport = Readonly<{
  packages: readonly NativeRuntimeExtensionPackage[]
  rejected: readonly Readonly<{ directory: string; code: string }>[]
}>

export type NativeRuntimeExtensionPublisher = Readonly<{
  publisher: string
  label: string
  fingerprint: string
  status: "official" | "trusted" | "revoked"
  trustedAt: number | null
  revokedAt: number | null
  revocationSequence: number | null
  revocationIssuedAt: number | null
  revokedDigestCount: number
  keySequence: number
  rotatedAt: number | null
  retiredKeyCount: number
}>

export type NativeRuntimeExtensionPublisherCandidate = Readonly<{
  publisher: string
  label: string
  publicKey: string
  fingerprint: string
}>

export type NativeRuntimeExtensionPublisherRotationCandidate = Readonly<{
  publisher: string
  label: string
  sequence: number
  issuedAt: number
  currentFingerprint: string
  nextFingerprint: string
  payload: string
  currentSignature: string
  nextSignature: string
}>

export type NativeRuntimeExtensionPublisherRotationResult = Readonly<{
  changed: true
  publisher: string
  sequence: number
  previousFingerprint: string
  fingerprint: string
  rotatedAt: number
  retiredKeyCount: number
}>

export type NativeRuntimeExtensionPackageMutation = Readonly<{
  changed: boolean
  cancelled: boolean
  operation: "installed" | "updated" | "unchanged" | "rolled-back" | null
  package: NativeRuntimeExtensionPackage | null
  previousVersion: number | null
}>

export type NativeRuntimeExtensionRevocationImport = Readonly<{
  changed: boolean
  cancelled: boolean
  publisher: string | null
  sequence: number | null
  revokedDigestCount: number
}>

export type NativeRuntimeExtensionRegistryEntry = Readonly<{
  id: string
  label: string
  summary: string
  version: number
  publisher: string
  publisherFingerprint: string
  permissions: readonly ("resources:read" | "tools:invoke")[]
  digest: string
  packageUrl: string
  packageSha256: string
  publishedAt: number
}>

export type NativeRuntimeExtensionRegistrySnapshot = Readonly<{
  source: "network" | "cache"
  stale: boolean
  fetchedAt: number
  generatedAt: number
  expiresAt: number
  sequence: number
  failureCode: string | null
  entries: readonly NativeRuntimeExtensionRegistryEntry[]
}>

export type NativeRuntimeExtensionUpdateCandidate = Readonly<{
  token: string
  registrySequence: number
  registryExpiresAt: number
  id: string
  label: string
  currentVersion: number
  nextVersion: number
  publisher: string
  publisherFingerprint: string
  currentPermissions: readonly ("resources:read" | "tools:invoke")[]
  nextPermissions: readonly ("resources:read" | "tools:invoke")[]
  addedPermissions: readonly ("resources:read" | "tools:invoke")[]
  removedPermissions: readonly ("resources:read" | "tools:invoke")[]
  digest: string
  packageSha256: string
  publishedAt: number
}>

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys)
  if (Object.keys(value).some((key) => !expected.has(key))) {
    throw new TypeError(`${label} contains unsupported fields`)
  }
}

function text(value: unknown, label: string, max = 1024): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${label} must be bounded text`)
  }
  return value
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value as number
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
  return value as number
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null ? null : safeInteger(value, label)
}

function digest(value: unknown, label: string): string {
  const result = text(value, label, 128)
  if (!/^sha256:[A-Za-z0-9_-]{43}$/.test(result)) {
    throw new TypeError(`${label} is invalid`)
  }
  return result
}

function extensionPermissions(
  value: unknown,
  label: string,
): ("resources:read" | "tools:invoke")[] {
  if (!Array.isArray(value) || value.length > 2) {
    throw new TypeError(`${label} must be bounded`)
  }
  const permissions = value.map((permission) => {
    if (permission !== "resources:read" && permission !== "tools:invoke") {
      throw new TypeError(`${label} contains an unsupported permission`)
    }
    return permission
  })
  if (
    new Set(permissions).size !== permissions.length ||
    !permissions.slice(1).every((permission, index) => permissions[index] < permission)
  ) {
    throw new TypeError(`${label} must be uniquely ordered`)
  }
  return permissions
}

function decodePackage(value: unknown): NativeRuntimeExtensionPackage {
  const packageValue = record(value, "Runtime extension package")
  exactKeys(
    packageValue,
    [
      "id",
      "label",
      "version",
      "publisher",
      "publisherFingerprint",
      "permissions",
      "digest",
      "permissionDigest",
      "connectorProtocol",
      "rollbackVersion",
    ],
    "Runtime extension package",
  )
  if (!Array.isArray(packageValue.permissions) || packageValue.permissions.length > 2) {
    throw new TypeError("Runtime extension permissions must be bounded")
  }
  const permissions = packageValue.permissions.map((permission) => {
    if (permission !== "resources:read" && permission !== "tools:invoke") {
      throw new TypeError("Runtime extension permission is unsupported")
    }
    return permission
  })
  if (
    new Set(permissions).size !== permissions.length ||
    !permissions.slice(1).every((permission, index) => permissions[index] < permission) ||
    packageValue.connectorProtocol !== "mcp-stdio"
  ) {
    throw new TypeError("Runtime extension connector is invalid")
  }
  const id = text(packageValue.id, "Runtime extension id", 128)
  const publisher = text(packageValue.publisher, "Runtime extension publisher", 128)
  const validId = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
  if (!validId.test(id) || !validId.test(publisher)) {
    throw new TypeError("Runtime extension identity is invalid")
  }
  return {
    id,
    label: text(packageValue.label, "Runtime extension label", 160),
    version: safeInteger(packageValue.version, "Runtime extension version"),
    publisher,
    publisherFingerprint: digest(
      packageValue.publisherFingerprint,
      "Runtime extension publisher fingerprint",
    ),
    permissions,
    digest: digest(packageValue.digest, "Runtime extension digest"),
    permissionDigest: digest(packageValue.permissionDigest, "Runtime extension permission digest"),
    connectorProtocol: packageValue.connectorProtocol,
    rollbackVersion: nullableInteger(
      packageValue.rollbackVersion,
      "Runtime extension rollback version",
    ),
  }
}

export function decodeNativeRuntimeExtensionDiscovery(
  value: unknown,
): NativeRuntimeExtensionDiscoveryReport {
  const result = record(value, "Runtime extension discovery")
  exactKeys(result, ["packages", "rejected"], "Runtime extension discovery")
  if (!Array.isArray(result.packages) || result.packages.length > 64) {
    throw new TypeError("Runtime extension packages must be bounded")
  }
  if (!Array.isArray(result.rejected) || result.rejected.length > 64) {
    throw new TypeError("Rejected runtime extension packages must be bounded")
  }
  const packages = result.packages.map(decodePackage)
  if (new Set(packages.map((item) => item.id)).size !== packages.length) {
    throw new TypeError("Runtime extension package ids must be unique")
  }
  const rejected = result.rejected.map((item) => {
    const rejectedValue = record(item, "Rejected runtime extension package")
    exactKeys(rejectedValue, ["directory", "code"], "Rejected runtime extension package")
    return {
      directory: text(rejectedValue.directory, "Rejected package directory", 128),
      code: text(rejectedValue.code, "Rejected package code", 128),
    }
  })
  if (new Set(rejected.map((item) => item.directory)).size !== rejected.length) {
    throw new TypeError("Rejected runtime extension directories must be unique")
  }
  return { packages, rejected }
}

export function decodeNativeRuntimeExtensionPublishers(
  value: unknown,
): readonly NativeRuntimeExtensionPublisher[] {
  if (!Array.isArray(value) || value.length > 65) {
    throw new TypeError("Runtime extension publishers must be bounded")
  }
  const publishers = value.map((item) => {
    const candidate = record(item, "Runtime extension publisher")
    exactKeys(
      candidate,
      [
        "publisher",
        "label",
        "fingerprint",
        "status",
        "trustedAt",
        "revokedAt",
        "revocationSequence",
        "revocationIssuedAt",
        "revokedDigestCount",
        "keySequence",
        "rotatedAt",
        "retiredKeyCount",
      ],
      "Runtime extension publisher",
    )
    if (
      candidate.status !== "official" &&
      candidate.status !== "trusted" &&
      candidate.status !== "revoked"
    ) {
      throw new TypeError("Runtime extension publisher status is invalid")
    }
    const publisher = text(candidate.publisher, "Runtime extension publisher id", 128)
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(publisher)) {
      throw new TypeError("Runtime extension publisher id is invalid")
    }
    const keySequence = safeInteger(
      candidate.keySequence,
      "Runtime extension publisher key sequence",
    )
    const retiredKeyCount = nonNegativeInteger(
      candidate.retiredKeyCount,
      "Runtime extension publisher retired key count",
    )
    const rotatedAt = nullableInteger(
      candidate.rotatedAt,
      "Runtime extension publisher rotation time",
    )
    if (
      retiredKeyCount + 1 !== keySequence ||
      retiredKeyCount > 32 ||
      (keySequence === 1 ? rotatedAt !== null : rotatedAt === null)
    ) {
      throw new TypeError("Runtime extension publisher key history is invalid")
    }
    return {
      publisher,
      label: text(candidate.label, "Runtime extension publisher label", 160),
      fingerprint: digest(candidate.fingerprint, "Runtime extension publisher fingerprint"),
      status: candidate.status,
      trustedAt: nullableInteger(candidate.trustedAt, "Runtime extension publisher trust time"),
      revokedAt: nullableInteger(candidate.revokedAt, "Runtime extension publisher revoke time"),
      revocationSequence: nullableInteger(
        candidate.revocationSequence,
        "Runtime extension revocation sequence",
      ),
      revocationIssuedAt: nullableInteger(
        candidate.revocationIssuedAt,
        "Runtime extension revocation issue time",
      ),
      revokedDigestCount: nonNegativeInteger(
        candidate.revokedDigestCount,
        "Runtime extension revoked digest count",
      ),
      keySequence,
      rotatedAt,
      retiredKeyCount,
    } satisfies NativeRuntimeExtensionPublisher
  })
  if (new Set(publishers.map((item) => item.publisher)).size !== publishers.length) {
    throw new TypeError("Runtime extension publisher ids must be unique")
  }
  return publishers
}

function signedDocumentPart(value: unknown, label: string, max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    value.includes("\u0000")
  ) {
    throw new TypeError(`${label} must be bounded signed content`)
  }
  return value
}

export function decodeNativeRuntimeExtensionPublisherRotationCandidate(
  value: unknown,
): NativeRuntimeExtensionPublisherRotationCandidate | null {
  if (value === null) return null
  const candidate = record(value, "Runtime extension publisher rotation candidate")
  exactKeys(
    candidate,
    [
      "publisher",
      "label",
      "sequence",
      "issuedAt",
      "currentFingerprint",
      "nextFingerprint",
      "payload",
      "currentSignature",
      "nextSignature",
    ],
    "Runtime extension publisher rotation candidate",
  )
  const publisher = text(candidate.publisher, "Runtime extension publisher rotation id", 128)
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(publisher)) {
    throw new TypeError("Runtime extension publisher rotation id is invalid")
  }
  const currentFingerprint = digest(
    candidate.currentFingerprint,
    "Runtime extension publisher current fingerprint",
  )
  const nextFingerprint = digest(
    candidate.nextFingerprint,
    "Runtime extension publisher next fingerprint",
  )
  if (currentFingerprint === nextFingerprint) {
    throw new TypeError("Runtime extension publisher rotation must change keys")
  }
  return {
    publisher,
    label: text(candidate.label, "Runtime extension publisher rotation label", 160),
    sequence: safeInteger(candidate.sequence, "Runtime extension publisher rotation sequence"),
    issuedAt: safeInteger(candidate.issuedAt, "Runtime extension publisher rotation issue time"),
    currentFingerprint,
    nextFingerprint,
    payload: signedDocumentPart(candidate.payload, "Publisher rotation payload", 32 * 1024),
    currentSignature: signedDocumentPart(
      candidate.currentSignature,
      "Publisher rotation current signature",
      8 * 1024,
    ),
    nextSignature: signedDocumentPart(
      candidate.nextSignature,
      "Publisher rotation next signature",
      8 * 1024,
    ),
  }
}

export function decodeNativeRuntimeExtensionPublisherRotationResult(
  value: unknown,
): NativeRuntimeExtensionPublisherRotationResult {
  const candidate = record(value, "Runtime extension publisher rotation result")
  exactKeys(
    candidate,
    [
      "changed",
      "publisher",
      "sequence",
      "previousFingerprint",
      "fingerprint",
      "rotatedAt",
      "retiredKeyCount",
    ],
    "Runtime extension publisher rotation result",
  )
  if (candidate.changed !== true) {
    throw new TypeError("Runtime extension publisher rotation result is invalid")
  }
  const publisher = text(candidate.publisher, "Runtime extension publisher rotation id", 128)
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(publisher)) {
    throw new TypeError("Runtime extension publisher rotation id is invalid")
  }
  const previousFingerprint = digest(
    candidate.previousFingerprint,
    "Runtime extension publisher previous fingerprint",
  )
  const fingerprint = digest(candidate.fingerprint, "Runtime extension publisher fingerprint")
  if (previousFingerprint === fingerprint) {
    throw new TypeError("Runtime extension publisher rotation did not change keys")
  }
  const sequence = safeInteger(candidate.sequence, "Runtime extension publisher rotation sequence")
  const retiredKeyCount = nonNegativeInteger(
    candidate.retiredKeyCount,
    "Runtime extension publisher retired key count",
  )
  if (retiredKeyCount + 1 !== sequence || retiredKeyCount > 32) {
    throw new TypeError("Runtime extension publisher rotation history is invalid")
  }
  return {
    changed: true,
    publisher,
    sequence,
    previousFingerprint,
    fingerprint,
    rotatedAt: safeInteger(candidate.rotatedAt, "Runtime extension publisher rotation time"),
    retiredKeyCount,
  }
}

export function decodeNativeRuntimeExtensionPublisherCandidate(
  value: unknown,
): NativeRuntimeExtensionPublisherCandidate | null {
  if (value === null) return null
  const candidate = record(value, "Runtime extension publisher candidate")
  exactKeys(
    candidate,
    ["publisher", "label", "publicKey", "fingerprint"],
    "Runtime extension publisher candidate",
  )
  const publisher = text(candidate.publisher, "Runtime extension publisher id", 128)
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(publisher)) {
    throw new TypeError("Runtime extension publisher id is invalid")
  }
  return {
    publisher,
    label: text(candidate.label, "Runtime extension publisher label", 160),
    publicKey: text(candidate.publicKey, "Runtime extension publisher public key", 256),
    fingerprint: digest(candidate.fingerprint, "Runtime extension publisher fingerprint"),
  }
}

export function decodeNativeRuntimeExtensionPackageMutation(
  value: unknown,
): NativeRuntimeExtensionPackageMutation {
  const candidate = record(value, "Runtime extension package mutation")
  exactKeys(
    candidate,
    ["changed", "cancelled", "operation", "package", "previousVersion"],
    "Runtime extension package mutation",
  )
  if (typeof candidate.changed !== "boolean" || typeof candidate.cancelled !== "boolean") {
    throw new TypeError("Runtime extension package mutation state is invalid")
  }
  if (
    candidate.operation !== null &&
    candidate.operation !== "installed" &&
    candidate.operation !== "updated" &&
    candidate.operation !== "unchanged" &&
    candidate.operation !== "rolled-back"
  ) {
    throw new TypeError("Runtime extension package operation is invalid")
  }
  return {
    changed: candidate.changed,
    cancelled: candidate.cancelled,
    operation: candidate.operation,
    package: candidate.package === null ? null : decodePackage(candidate.package),
    previousVersion: nullableInteger(
      candidate.previousVersion,
      "Runtime extension previous version",
    ),
  }
}

export function decodeNativeRuntimeExtensionRevocationImport(
  value: unknown,
): NativeRuntimeExtensionRevocationImport {
  const candidate = record(value, "Runtime extension revocation import")
  exactKeys(
    candidate,
    ["changed", "cancelled", "publisher", "sequence", "revokedDigestCount"],
    "Runtime extension revocation import",
  )
  if (typeof candidate.changed !== "boolean" || typeof candidate.cancelled !== "boolean") {
    throw new TypeError("Runtime extension revocation import state is invalid")
  }
  return {
    changed: candidate.changed,
    cancelled: candidate.cancelled,
    publisher:
      candidate.publisher === null
        ? null
        : text(candidate.publisher, "Runtime extension revocation publisher", 128),
    sequence: nullableInteger(candidate.sequence, "Runtime extension revocation sequence"),
    revokedDigestCount: nonNegativeInteger(
      candidate.revokedDigestCount,
      "Runtime extension revoked digest count",
    ),
  }
}

function registryUrl(value: unknown): string {
  const result = text(value, "Runtime extension registry package URL", 4096)
  let parsed: URL
  try {
    parsed = new URL(result)
  } catch {
    throw new TypeError("Runtime extension registry package URL is invalid")
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError("Runtime extension registry package URL is unsafe")
  }
  return result
}

export function decodeNativeRuntimeExtensionRegistrySnapshot(
  value: unknown,
): NativeRuntimeExtensionRegistrySnapshot {
  const candidate = record(value, "Runtime extension registry snapshot")
  exactKeys(
    candidate,
    [
      "source",
      "stale",
      "fetchedAt",
      "generatedAt",
      "expiresAt",
      "sequence",
      "failureCode",
      "entries",
    ],
    "Runtime extension registry snapshot",
  )
  if (
    (candidate.source !== "network" && candidate.source !== "cache") ||
    typeof candidate.stale !== "boolean" ||
    !Array.isArray(candidate.entries) ||
    candidate.entries.length > 256
  ) {
    throw new TypeError("Runtime extension registry snapshot is invalid")
  }
  const entries = candidate.entries.map((item) => {
    const entry = record(item, "Runtime extension registry entry")
    exactKeys(
      entry,
      [
        "id",
        "label",
        "summary",
        "version",
        "publisher",
        "publisherFingerprint",
        "permissions",
        "digest",
        "packageUrl",
        "packageSha256",
        "publishedAt",
      ],
      "Runtime extension registry entry",
    )
    if (!Array.isArray(entry.permissions) || entry.permissions.length > 2) {
      throw new TypeError("Runtime extension registry permissions must be bounded")
    }
    const permissions = entry.permissions.map((permission) => {
      if (permission !== "resources:read" && permission !== "tools:invoke") {
        throw new TypeError("Runtime extension registry permission is unsupported")
      }
      return permission
    })
    if (
      permissions.length === 0 ||
      new Set(permissions).size !== permissions.length ||
      !permissions.slice(1).every((permission, index) => permissions[index] < permission)
    ) {
      throw new TypeError("Runtime extension registry permissions are invalid")
    }
    const id = text(entry.id, "Runtime extension registry id", 128)
    const publisher = text(entry.publisher, "Runtime extension registry publisher", 128)
    if (
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(id) ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(publisher)
    ) {
      throw new TypeError("Runtime extension registry identity is invalid")
    }
    const packageSha256 = text(entry.packageSha256, "Runtime extension package SHA-256", 64)
    if (!/^[a-f0-9]{64}$/.test(packageSha256)) {
      throw new TypeError("Runtime extension package SHA-256 is invalid")
    }
    return {
      id,
      label: text(entry.label, "Runtime extension registry label", 160),
      summary: text(entry.summary, "Runtime extension registry summary", 512),
      version: safeInteger(entry.version, "Runtime extension registry version"),
      publisher,
      publisherFingerprint: digest(
        entry.publisherFingerprint,
        "Runtime extension registry publisher fingerprint",
      ),
      permissions,
      digest: digest(entry.digest, "Runtime extension registry digest"),
      packageUrl: registryUrl(entry.packageUrl),
      packageSha256,
      publishedAt: safeInteger(entry.publishedAt, "Runtime extension registry publish time"),
    } satisfies NativeRuntimeExtensionRegistryEntry
  })
  if (!entries.slice(1).every((entry, index) => entries[index].id < entry.id)) {
    throw new TypeError("Runtime extension registry entries must be uniquely ordered")
  }
  const failureCode =
    candidate.failureCode === null
      ? null
      : text(candidate.failureCode, "Runtime extension registry failure code", 128)
  if (failureCode !== null && !/^[a-z0-9-]+$/.test(failureCode)) {
    throw new TypeError("Runtime extension registry failure code is invalid")
  }
  const generatedAt = safeInteger(
    candidate.generatedAt,
    "Runtime extension registry generation time",
  )
  const expiresAt = safeInteger(candidate.expiresAt, "Runtime extension registry expiry time")
  if (expiresAt <= generatedAt) {
    throw new TypeError("Runtime extension registry validity window is invalid")
  }
  return {
    source: candidate.source,
    stale: candidate.stale,
    fetchedAt: safeInteger(candidate.fetchedAt, "Runtime extension registry fetch time"),
    generatedAt,
    expiresAt,
    sequence: safeInteger(candidate.sequence, "Runtime extension registry sequence"),
    failureCode,
    entries,
  }
}

export function decodeNativeRuntimeExtensionUpdateCandidate(
  value: unknown,
): NativeRuntimeExtensionUpdateCandidate {
  const candidate = record(value, "Runtime extension update candidate")
  exactKeys(
    candidate,
    [
      "token",
      "registrySequence",
      "registryExpiresAt",
      "id",
      "label",
      "currentVersion",
      "nextVersion",
      "publisher",
      "publisherFingerprint",
      "currentPermissions",
      "nextPermissions",
      "addedPermissions",
      "removedPermissions",
      "digest",
      "packageSha256",
      "publishedAt",
    ],
    "Runtime extension update candidate",
  )
  const token = text(candidate.token, "Runtime extension update token", 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) {
    throw new TypeError("Runtime extension update token is invalid")
  }
  const id = text(candidate.id, "Runtime extension update id", 128)
  const publisher = text(candidate.publisher, "Runtime extension update publisher", 128)
  const validId = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
  if (!validId.test(id) || !validId.test(publisher)) {
    throw new TypeError("Runtime extension update identity is invalid")
  }
  const currentPermissions = extensionPermissions(
    candidate.currentPermissions,
    "Runtime extension current permissions",
  )
  const nextPermissions = extensionPermissions(
    candidate.nextPermissions,
    "Runtime extension next permissions",
  )
  const addedPermissions = extensionPermissions(
    candidate.addedPermissions,
    "Runtime extension added permissions",
  )
  const removedPermissions = extensionPermissions(
    candidate.removedPermissions,
    "Runtime extension removed permissions",
  )
  const expectedAdded = nextPermissions.filter(
    (permission) => !currentPermissions.includes(permission),
  )
  const expectedRemoved = currentPermissions.filter(
    (permission) => !nextPermissions.includes(permission),
  )
  if (
    addedPermissions.join("\u0000") !== expectedAdded.join("\u0000") ||
    removedPermissions.join("\u0000") !== expectedRemoved.join("\u0000")
  ) {
    throw new TypeError("Runtime extension permission delta is invalid")
  }
  const currentVersion = safeInteger(candidate.currentVersion, "Runtime extension current version")
  const nextVersion = safeInteger(candidate.nextVersion, "Runtime extension next version")
  const registryExpiresAt = safeInteger(
    candidate.registryExpiresAt,
    "Runtime extension registry expiry time",
  )
  const publishedAt = safeInteger(candidate.publishedAt, "Runtime extension publish time")
  if (
    currentPermissions.length === 0 ||
    nextPermissions.length === 0 ||
    nextVersion <= currentVersion ||
    publishedAt >= registryExpiresAt
  ) {
    throw new TypeError("Runtime extension update version is invalid")
  }
  const packageSha256 = text(candidate.packageSha256, "Runtime extension package SHA-256", 64)
  if (!/^[a-f0-9]{64}$/.test(packageSha256)) {
    throw new TypeError("Runtime extension package SHA-256 is invalid")
  }
  return {
    token,
    registrySequence: safeInteger(
      candidate.registrySequence,
      "Runtime extension registry sequence",
    ),
    registryExpiresAt,
    id,
    label: text(candidate.label, "Runtime extension update label", 160),
    currentVersion,
    nextVersion,
    publisher,
    publisherFingerprint: digest(
      candidate.publisherFingerprint,
      "Runtime extension publisher fingerprint",
    ),
    currentPermissions,
    nextPermissions,
    addedPermissions,
    removedPermissions,
    digest: digest(candidate.digest, "Runtime extension update digest"),
    packageSha256,
    publishedAt,
  }
}

export async function discoverNativeRuntimeExtensions(): Promise<NativeRuntimeExtensionDiscoveryReport> {
  if (!isTauri()) return { packages: [], rejected: [] }
  return decodeNativeRuntimeExtensionDiscovery(await invoke("runtime_extension_discover"))
}

export async function getNativeRuntimeExtensionRegistrySnapshot(): Promise<NativeRuntimeExtensionRegistrySnapshot | null> {
  if (!isTauri()) return null
  const value = await invoke<unknown>("runtime_extension_registry_snapshot")
  return value === null ? null : decodeNativeRuntimeExtensionRegistrySnapshot(value)
}

export async function refreshNativeRuntimeExtensionRegistry(): Promise<NativeRuntimeExtensionRegistrySnapshot> {
  if (!isTauri()) throw new Error("extension-registry-unavailable")
  return decodeNativeRuntimeExtensionRegistrySnapshot(
    await invoke("runtime_extension_registry_refresh"),
  )
}

export async function prepareNativeRuntimeExtensionUpdate(
  id: string,
): Promise<NativeRuntimeExtensionUpdateCandidate> {
  if (!isTauri()) throw new Error("extension-update-unavailable")
  return decodeNativeRuntimeExtensionUpdateCandidate(
    await invoke("runtime_extension_update_prepare", { id }),
  )
}

export async function applyNativeRuntimeExtensionUpdate(
  candidate: NativeRuntimeExtensionUpdateCandidate,
): Promise<NativeRuntimeExtensionPackageMutation> {
  if (!isTauri()) throw new Error("extension-update-unavailable")
  return decodeNativeRuntimeExtensionPackageMutation(
    await invoke("runtime_extension_update_apply", { candidate }),
  )
}

export async function discardNativeRuntimeExtensionUpdate(token: string): Promise<boolean> {
  if (!isTauri()) return false
  const changed = await invoke<unknown>("runtime_extension_update_discard", { token })
  if (typeof changed !== "boolean") {
    throw new TypeError("Runtime extension update discard result is invalid")
  }
  return changed
}

export function nativeRuntimeExtensionManagementAvailable(): boolean {
  return isTauri()
}

export async function listNativeRuntimeExtensionPublishers(): Promise<
  readonly NativeRuntimeExtensionPublisher[]
> {
  if (!isTauri()) return []
  return decodeNativeRuntimeExtensionPublishers(await invoke("runtime_extension_publisher_list"))
}

export async function inspectNativeRuntimeExtensionPublisher(): Promise<NativeRuntimeExtensionPublisherCandidate | null> {
  if (!isTauri()) return null
  return decodeNativeRuntimeExtensionPublisherCandidate(
    await invoke("runtime_extension_publisher_inspect"),
  )
}

export async function trustNativeRuntimeExtensionPublisher(
  candidate: NativeRuntimeExtensionPublisherCandidate,
): Promise<boolean> {
  if (!isTauri()) return false
  const changed = await invoke<unknown>("runtime_extension_publisher_trust", candidate)
  if (typeof changed !== "boolean") throw new TypeError("Publisher trust result is invalid")
  return changed
}

export async function inspectNativeRuntimeExtensionPublisherRotation(): Promise<NativeRuntimeExtensionPublisherRotationCandidate | null> {
  if (!isTauri()) return null
  return decodeNativeRuntimeExtensionPublisherRotationCandidate(
    await invoke("runtime_extension_publisher_rotation_inspect"),
  )
}

export async function applyNativeRuntimeExtensionPublisherRotation(
  candidate: NativeRuntimeExtensionPublisherRotationCandidate,
): Promise<NativeRuntimeExtensionPublisherRotationResult> {
  if (!isTauri()) throw new Error("publisher-rotation-unavailable")
  return decodeNativeRuntimeExtensionPublisherRotationResult(
    await invoke("runtime_extension_publisher_rotation_apply", { candidate }),
  )
}

export async function revokeNativeRuntimeExtensionPublisher(
  publisher: string,
  fingerprint: string,
): Promise<boolean> {
  if (!isTauri()) return false
  const changed = await invoke<unknown>("runtime_extension_publisher_revoke", {
    publisher,
    fingerprint,
  })
  if (typeof changed !== "boolean") throw new TypeError("Publisher revoke result is invalid")
  return changed
}

export async function importNativeRuntimeExtensionRevocations(): Promise<NativeRuntimeExtensionRevocationImport> {
  if (!isTauri()) {
    return {
      changed: false,
      cancelled: true,
      publisher: null,
      sequence: null,
      revokedDigestCount: 0,
    }
  }
  return decodeNativeRuntimeExtensionRevocationImport(
    await invoke("runtime_extension_revocation_import"),
  )
}

export async function installNativeRuntimeExtension(): Promise<NativeRuntimeExtensionPackageMutation> {
  if (!isTauri()) {
    return {
      changed: false,
      cancelled: true,
      operation: null,
      package: null,
      previousVersion: null,
    }
  }
  return decodeNativeRuntimeExtensionPackageMutation(await invoke("runtime_extension_install"))
}

export async function rollbackNativeRuntimeExtension(
  id: string,
): Promise<NativeRuntimeExtensionPackageMutation> {
  return decodeNativeRuntimeExtensionPackageMutation(
    await invoke("runtime_extension_rollback", { id }),
  )
}

export async function uninstallNativeRuntimeExtension(id: string): Promise<boolean> {
  if (!isTauri()) return false
  const changed = await invoke<unknown>("runtime_extension_uninstall", { id })
  if (typeof changed !== "boolean") throw new TypeError("Extension uninstall result is invalid")
  return changed
}

export function verifyNativeRuntimeExtension(
  id: string,
  version: number,
  digest: string,
  permissionDigest: string,
): Promise<RuntimeExtensionVerificationReceipt> {
  return invoke("runtime_extension_verify", { id, version, digest, permissionDigest })
}

export function spawnNativeRuntimeExtension(
  sessionId: string,
  packageId: string,
  digest: string,
): Promise<void> {
  return invoke("runtime_extension_spawn", { sessionId, packageId, digest })
}
