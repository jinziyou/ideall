import assert from "node:assert/strict"
import { test } from "node:test"
import type {
  RuntimeExtensionDescriptor,
  RuntimeExtensionVerificationReceipt,
} from "./runtime-extensions"
import {
  createSecureRuntimeExtensionConsentAuthority,
  type SecureConsentDeps,
} from "./runtime-extensions/secure-consent"
import { createRuntimeExtensionTrustBoundary } from "./runtime-extensions/trust-host"

const descriptor: RuntimeExtensionDescriptor = {
  id: "example.connector",
  label: "Example connector",
  version: 3,
  source: { kind: "package", id: "example.package" },
  permissions: ["fs:read"],
  digest: "content-digest",
  permissionDigest: "permission-digest",
}

const verification: RuntimeExtensionVerificationReceipt = {
  receiptId: "verification-receipt",
  verifierId: "platform-verifier",
  id: descriptor.id,
  version: descriptor.version,
  digest: descriptor.digest,
  permissionDigest: descriptor.permissionDigest,
  verifiedAt: 10,
}

function memorySecureConsent(overrides: Partial<SecureConsentDeps> = {}) {
  const values = new Map<string, string>()
  const deleted: string[] = []
  const deps: SecureConsentDeps = {
    available: () => true,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value)
      return "system-keychain"
    },
    delete: async (key) => {
      deleted.push(key)
      values.delete(key)
    },
    randomId: () => "00000000-0000-4000-8000-000000000001",
    now: () => 20,
    ...overrides,
  }
  return { authority: createSecureRuntimeExtensionConsentAuthority(deps), values, deleted }
}

test("runtime extension trust host: source verifier is one-time, immutable and fail-closed", async () => {
  const boundary = createRuntimeExtensionTrustBoundary()
  await assert.rejects(
    Promise.resolve().then(() => boundary.verifier.verify(descriptor)),
    /No runtime/,
  )

  let verifies = 0
  const host = {
    verifier: {
      verify(input: RuntimeExtensionDescriptor) {
        verifies += 1
        assert.equal(input, descriptor)
        return verification
      },
    },
  }
  boundary.configure(host)
  ;(host.verifier as unknown as { verify: () => null }).verify = () => null

  assert.equal(await boundary.verifier.verify(descriptor), verification)
  assert.equal(verifies, 1)
  assert.throws(() => boundary.configure(host), /already configured/)
})

test("secure runtime extension consent: keychain receipt round-trips, binds descriptor and revokes", async () => {
  const fixture = memorySecureConsent()
  const receipt = await fixture.authority.request(descriptor, verification)

  assert.ok(receipt)
  assert.equal(receipt.receiptId, "consent-00000000-0000-4000-8000-000000000001")
  assert.equal(receipt.grantedAt, 20)
  assert.equal(fixture.values.size, 1)
  assert.deepEqual(
    await fixture.authority.restore(descriptor, verification, receipt.receiptId),
    receipt,
  )
  assert.equal(
    await fixture.authority.restore(
      { ...descriptor, permissionDigest: "changed-permissions" },
      verification,
      receipt.receiptId,
    ),
    null,
  )

  await fixture.authority.revoke?.(receipt)
  assert.equal(fixture.values.size, 0)
  assert.equal(fixture.deleted.length, 1)
  assert.equal(await fixture.authority.restore(descriptor, verification, receipt.receiptId), null)

  const next = await fixture.authority.request(descriptor, verification)
  assert.ok(next)
  await assert.rejects(
    Promise.resolve(
      fixture.authority.revokePersisted?.({
        receiptId: next.receiptId,
        id: "another.connector",
        version: next.version,
        digest: next.digest,
        permissionDigest: next.permissionDigest,
      }),
    ),
    /binding does not match/,
  )
  assert.equal(fixture.values.size, 1)
  await fixture.authority.revokePersisted?.({
    receiptId: next.receiptId,
    id: next.id,
    version: next.version,
    digest: next.digest,
    permissionDigest: next.permissionDigest,
  })
  assert.equal(fixture.values.size, 0)
  assert.equal(fixture.deleted.length, 2)
})

test("secure runtime extension consent: unavailable, fallback and corrupted stores never grant", async () => {
  const unavailable = memorySecureConsent({ available: () => false }).authority
  await assert.rejects(
    Promise.resolve().then(() => unavailable.request(descriptor, verification)),
    /desktop system credential store/,
  )

  const fallback = memorySecureConsent({
    set: async () => "web-localStorage",
  })
  await assert.rejects(
    Promise.resolve(fallback.authority.request(descriptor, verification)),
    /not stored/,
  )
  assert.equal(fallback.deleted.length, 1)

  const corrupted = memorySecureConsent({ get: async () => "{not-json" })
  await assert.rejects(
    Promise.resolve(corrupted.authority.request(descriptor, verification)),
    /verification failed/,
  )
  assert.equal(corrupted.deleted.length, 1)

  const mismatch = { ...verification, digest: "different-content" }
  await assert.rejects(
    Promise.resolve(memorySecureConsent().authority.request(descriptor, mismatch)),
    /does not match consent/,
  )
})
