import { isTauri } from "@/lib/tauri"
import { secureDelete, secureGet, secureSet, type SecureStoreBackend } from "@/lib/secure-store"
import type {
  RuntimeExtensionConsentAuthority,
  RuntimeExtensionConsentReference,
  RuntimeExtensionConsentReceipt,
  RuntimeExtensionDescriptor,
  RuntimeExtensionVerificationReceipt,
} from "./types"
import { validConsentReceipt } from "./persistence"

const CONSENT_KEY_PREFIX = "ideall:runtime-extension-consent:"
const SECURE_RECEIPT_ID =
  /^consent-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type SecureConsentDeps = Readonly<{
  available(): boolean
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<SecureStoreBackend>
  delete(key: string): Promise<void>
  randomId(): string
  now(): number
}>

const DEFAULT_DEPS: SecureConsentDeps = {
  available: isTauri,
  get: secureGet,
  set: secureSet,
  delete: secureDelete,
  randomId: () => globalThis.crypto.randomUUID(),
  now: Date.now,
}

function consentKey(receiptId: string): string {
  if (!SECURE_RECEIPT_ID.test(receiptId)) throw new TypeError("Invalid extension consent id")
  return `${CONSENT_KEY_PREFIX}${receiptId}`
}

function matchesVerification(
  descriptor: RuntimeExtensionDescriptor,
  verification: RuntimeExtensionVerificationReceipt,
): boolean {
  return (
    verification.id === descriptor.id &&
    verification.version === descriptor.version &&
    verification.digest === descriptor.digest &&
    verification.permissionDigest === descriptor.permissionDigest
  )
}

function parseSecureConsent(
  raw: string | null,
  descriptor: RuntimeExtensionDescriptor | RuntimeExtensionConsentReference,
  expectedReceiptId: string,
): RuntimeExtensionConsentReceipt | null {
  if (!raw || raw.length > 8 * 1024) return null
  try {
    const candidate = JSON.parse(raw) as RuntimeExtensionConsentReceipt
    if (candidate.receiptId !== expectedReceiptId || !validConsentReceipt(candidate, descriptor)) {
      return null
    }
    return Object.freeze({ ...candidate })
  } catch {
    return null
  }
}

/** 系统凭据库是 consent 的真相源；公开 localStorage 快照只保存不可自证的 receipt id。 */
export function createSecureRuntimeExtensionConsentAuthority(
  deps: SecureConsentDeps = DEFAULT_DEPS,
): RuntimeExtensionConsentAuthority {
  const requireNative = () => {
    if (!deps.available()) {
      throw new Error("Runtime extension consent requires the desktop system credential store")
    }
  }

  return Object.freeze({
    async request(descriptor, verification) {
      requireNative()
      if (!matchesVerification(descriptor, verification)) {
        throw new Error(`Runtime extension verification does not match consent: ${descriptor.id}`)
      }
      const receipt = Object.freeze({
        receiptId: `consent-${deps.randomId()}`,
        id: descriptor.id,
        version: descriptor.version,
        digest: descriptor.digest,
        permissionDigest: descriptor.permissionDigest,
        grantedAt: deps.now(),
      })
      const key = consentKey(receipt.receiptId)
      const backend = await deps.set(key, JSON.stringify(receipt))
      if (backend !== "system-keychain") {
        await deps.delete(key)
        throw new Error("Extension consent was not stored in the system credential store")
      }
      const restored = parseSecureConsent(await deps.get(key), descriptor, receipt.receiptId)
      if (!restored) {
        await deps.delete(key)
        throw new Error("Extension consent storage verification failed")
      }
      return restored
    },
    async restore(descriptor, verification, receiptId) {
      requireNative()
      if (!matchesVerification(descriptor, verification)) return null
      return parseSecureConsent(await deps.get(consentKey(receiptId)), descriptor, receiptId)
    },
    async revoke(receipt) {
      requireNative()
      await deps.delete(consentKey(receipt.receiptId))
    },
    async revokePersisted(reference) {
      requireNative()
      if (!SECURE_RECEIPT_ID.test(reference.receiptId)) return
      const key = consentKey(reference.receiptId)
      const raw = await deps.get(key)
      if (raw === null) return
      if (!parseSecureConsent(raw, reference, reference.receiptId)) {
        throw new Error("Persisted extension consent binding does not match")
      }
      await deps.delete(key)
    },
  })
}
