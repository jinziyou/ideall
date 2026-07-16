import {
  WORKSPACE_ARCHIVE_ENCRYPTED_KIND,
  WORKSPACE_ARCHIVE_ENCRYPTED_VERSION,
  WORKSPACE_ARCHIVE_LIMITS,
  WORKSPACE_ARCHIVE_MAX_PASSPHRASE_LENGTH,
  WORKSPACE_ARCHIVE_MIN_PASSPHRASE_LENGTH,
  WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
  type WorkspaceArchiveLimits,
} from "@protocol/workspace-archive"
import { base64ToBytes, bytesToBase64, isBase64 } from "@/lib/base64"

const SALT_BYTES = 16
const IV_BYTES = 12
const AES_GCM_TAG_BYTES = 16
const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

type EncryptedWorkspaceArchiveEnvelope = Readonly<{
  kind: typeof WORKSPACE_ARCHIVE_ENCRYPTED_KIND
  version: typeof WORKSPACE_ARCHIVE_ENCRYPTED_VERSION
  createdAt: string
  plaintextBytes: number
  kdf: Readonly<{
    name: "PBKDF2"
    hash: "SHA-256"
    iterations: typeof WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS
    salt: string
  }>
  cipher: Readonly<{
    name: "AES-GCM"
    iv: string
  }>
  ciphertext: string
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function assertPassphrase(passphrase: string): void {
  if (
    typeof passphrase !== "string" ||
    passphrase.length < WORKSPACE_ARCHIVE_MIN_PASSPHRASE_LENGTH ||
    passphrase.length > WORKSPACE_ARCHIVE_MAX_PASSPHRASE_LENGTH
  ) {
    throw new Error(
      `归档口令长度必须为 ${WORKSPACE_ARCHIVE_MIN_PASSPHRASE_LENGTH}–${WORKSPACE_ARCHIVE_MAX_PASSPHRASE_LENGTH} 个字符`,
    )
  }
}

function assertBytesWithin(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label}超出限制（最大 ${maximum} 字节）`)
  }
}

function additionalData(
  envelope: Pick<
    EncryptedWorkspaceArchiveEnvelope,
    "kind" | "version" | "createdAt" | "plaintextBytes"
  >,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify({
      kind: envelope.kind,
      version: envelope.version,
      createdAt: envelope.createdAt,
      plaintextBytes: envelope.plaintextBytes,
      iterations: WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
    }),
  ) as Uint8Array<ArrayBuffer>
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const source = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase) as Uint8Array<ArrayBuffer>,
    "PBKDF2",
    false,
    ["deriveKey"],
  )
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
      salt,
    },
    source,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

function parseEnvelope(
  raw: string,
  limits: WorkspaceArchiveLimits,
): EncryptedWorkspaceArchiveEnvelope {
  assertBytesWithin(raw.length, limits.maxEnvelopeBytes, "加密归档")
  assertBytesWithin(encoder.encode(raw).byteLength, limits.maxEnvelopeBytes, "加密归档")
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error("加密归档格式无效")
  }
  if (!isRecord(value) || !isRecord(value.kdf) || !isRecord(value.cipher)) {
    throw new Error("加密归档格式无效")
  }
  if (
    value.kind !== WORKSPACE_ARCHIVE_ENCRYPTED_KIND ||
    value.version !== WORKSPACE_ARCHIVE_ENCRYPTED_VERSION ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Number.isSafeInteger(value.plaintextBytes) ||
    (value.plaintextBytes as number) < 0 ||
    (value.plaintextBytes as number) > limits.maxPlaintextBytes ||
    value.kdf.name !== "PBKDF2" ||
    value.kdf.hash !== "SHA-256" ||
    value.kdf.iterations !== WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS ||
    typeof value.kdf.salt !== "string" ||
    !isBase64(value.kdf.salt) ||
    value.cipher.name !== "AES-GCM" ||
    typeof value.cipher.iv !== "string" ||
    !isBase64(value.cipher.iv) ||
    typeof value.ciphertext !== "string" ||
    !isBase64(value.ciphertext)
  ) {
    throw new Error("加密归档格式无效")
  }
  const plaintextBytes = value.plaintextBytes as number
  if (
    value.kdf.salt.length !== 4 * Math.ceil(SALT_BYTES / 3) ||
    value.cipher.iv.length !== 4 * Math.ceil(IV_BYTES / 3) ||
    value.ciphertext.length !== 4 * Math.ceil((plaintextBytes + AES_GCM_TAG_BYTES) / 3)
  ) {
    throw new Error("加密归档格式无效")
  }
  const salt = base64ToBytes(value.kdf.salt)
  const iv = base64ToBytes(value.cipher.iv)
  const ciphertext = base64ToBytes(value.ciphertext)
  if (
    salt.byteLength !== SALT_BYTES ||
    iv.byteLength !== IV_BYTES ||
    ciphertext.byteLength !== plaintextBytes + AES_GCM_TAG_BYTES
  ) {
    throw new Error("加密归档格式无效")
  }
  return value as EncryptedWorkspaceArchiveEnvelope
}

export function isEncryptedWorkspaceArchive(raw: string): boolean {
  try {
    const value = JSON.parse(raw) as { kind?: unknown }
    return value?.kind === WORKSPACE_ARCHIVE_ENCRYPTED_KIND
  } catch {
    return false
  }
}

export async function encryptWorkspaceArchive(
  plaintext: string,
  passphrase: string,
  options: Readonly<{
    limits?: WorkspaceArchiveLimits
    createdAt?: string
  }> = {},
): Promise<string> {
  assertPassphrase(passphrase)
  const limits = options.limits ?? WORKSPACE_ARCHIVE_LIMITS
  const plaintextBuffer = encoder.encode(plaintext) as Uint8Array<ArrayBuffer>
  assertBytesWithin(plaintextBuffer.byteLength, limits.maxPlaintextBytes, "工作区归档明文")
  const createdAt = options.createdAt ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("加密归档创建时间无效")
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES)) as Uint8Array<ArrayBuffer>
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES)) as Uint8Array<ArrayBuffer>
  const header = {
    kind: WORKSPACE_ARCHIVE_ENCRYPTED_KIND,
    version: WORKSPACE_ARCHIVE_ENCRYPTED_VERSION,
    createdAt,
    plaintextBytes: plaintextBuffer.byteLength,
  } as const
  const key = await deriveKey(passphrase, salt)
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(header), tagLength: 128 },
    key,
    plaintextBuffer,
  )
  const envelope: EncryptedWorkspaceArchiveEnvelope = {
    ...header,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    cipher: { name: "AES-GCM", iv: bytesToBase64(iv) },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
  const raw = JSON.stringify(envelope, null, 2)
  assertBytesWithin(encoder.encode(raw).byteLength, limits.maxEnvelopeBytes, "加密归档")
  return raw
}

export async function decryptWorkspaceArchive(
  raw: string,
  passphrase: string,
  limits: WorkspaceArchiveLimits = WORKSPACE_ARCHIVE_LIMITS,
): Promise<string> {
  assertPassphrase(passphrase)
  const envelope = parseEnvelope(raw, limits)
  try {
    const salt = base64ToBytes(envelope.kdf.salt)
    const key = await deriveKey(passphrase, salt)
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(envelope.cipher.iv),
        additionalData: additionalData(envelope),
        tagLength: 128,
      },
      key,
      base64ToBytes(envelope.ciphertext),
    )
    if (plaintext.byteLength !== envelope.plaintextBytes) {
      throw new Error("plaintext length mismatch")
    }
    return decoder.decode(plaintext)
  } catch {
    throw new Error("口令错误或加密归档已损坏")
  }
}
