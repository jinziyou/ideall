import assert from "node:assert/strict"
import { test } from "node:test"
import {
  decodeNativeRuntimeExtensionDiscovery,
  decodeNativeRuntimeExtensionPackageMutation,
  decodeNativeRuntimeExtensionPublisherCandidate,
  decodeNativeRuntimeExtensionPublisherRotationCandidate,
  decodeNativeRuntimeExtensionPublisherRotationResult,
  decodeNativeRuntimeExtensionPublishers,
  decodeNativeRuntimeExtensionRevocationImport,
  decodeNativeRuntimeExtensionRegistrySnapshot,
  decodeNativeRuntimeExtensionUpdateCandidate,
} from "./native-host"

const digest = `sha256:${"A".repeat(43)}`

function registrySnapshot(overrides: Record<string, unknown> = {}): unknown {
  return {
    source: "network",
    stale: false,
    fetchedAt: 200,
    generatedAt: 100,
    expiresAt: 300,
    sequence: 4,
    failureCode: null,
    entries: [
      {
        id: "acme.search",
        label: "Acme Search",
        summary: "Search local resources.",
        version: 3,
        publisher: "acme.official",
        publisherFingerprint: digest,
        permissions: ["resources:read"],
        digest,
        packageUrl: "https://downloads.example.test/acme.search.ideall-extension",
        packageSha256: "a".repeat(64),
        publishedAt: 90,
        ...overrides,
      },
    ],
  }
}

function report(overrides: Record<string, unknown> = {}): unknown {
  return {
    packages: [
      {
        id: "acme.search",
        label: "Acme Search",
        version: 3,
        publisher: "acme.official",
        publisherFingerprint: digest,
        permissions: ["resources:read", "tools:invoke"],
        digest,
        permissionDigest: digest,
        connectorProtocol: "mcp-stdio",
        rollbackVersion: null,
        ...overrides,
      },
    ],
    rejected: [{ directory: "bad.connector", code: "signature-rejected" }],
  }
}

function updateCandidate(overrides: Record<string, unknown> = {}): unknown {
  return {
    token: "123e4567-e89b-42d3-a456-426614174000",
    registrySequence: 4,
    registryExpiresAt: 300,
    id: "acme.search",
    label: "Acme Search",
    currentVersion: 2,
    nextVersion: 3,
    publisher: "acme.official",
    publisherFingerprint: digest,
    currentPermissions: ["resources:read"],
    nextPermissions: ["resources:read", "tools:invoke"],
    addedPermissions: ["tools:invoke"],
    removedPermissions: [],
    digest,
    packageSha256: "a".repeat(64),
    publishedAt: 90,
    ...overrides,
  }
}

test("native runtime extension discovery accepts the bounded Rust contract", () => {
  assert.deepEqual(decodeNativeRuntimeExtensionDiscovery(report()), {
    packages: [
      {
        id: "acme.search",
        label: "Acme Search",
        version: 3,
        publisher: "acme.official",
        publisherFingerprint: digest,
        permissions: ["resources:read", "tools:invoke"],
        digest,
        permissionDigest: digest,
        connectorProtocol: "mcp-stdio",
        rollbackVersion: null,
      },
    ],
    rejected: [{ directory: "bad.connector", code: "signature-rejected" }],
  })
})

test("native runtime extension update candidate binds versions and permission delta", () => {
  assert.deepEqual(
    decodeNativeRuntimeExtensionUpdateCandidate(updateCandidate()),
    updateCandidate(),
  )
  assert.throws(
    () => decodeNativeRuntimeExtensionUpdateCandidate(updateCandidate({ addedPermissions: [] })),
    /permission delta/,
  )
  assert.throws(
    () => decodeNativeRuntimeExtensionUpdateCandidate(updateCandidate({ nextVersion: 2 })),
    /version/,
  )
  assert.throws(
    () => decodeNativeRuntimeExtensionUpdateCandidate(updateCandidate({ path: "/tmp/pkg" })),
    /unsupported fields/,
  )
})

test("native runtime extension discovery rejects reordered, duplicate or unknown permissions", () => {
  for (const permissions of [
    ["tools:invoke", "resources:read"],
    ["resources:read", "resources:read"],
    ["resources:read", "host:execute"],
  ]) {
    assert.throws(
      () => decodeNativeRuntimeExtensionDiscovery(report({ permissions })),
      /permission|connector/i,
    )
  }
})

test("native runtime extension discovery rejects malformed identities, digests and fields", () => {
  for (const overrides of [
    { id: "../escape" },
    { publisher: "ACME" },
    { digest: "sha256:not-a-digest" },
    { connectorProtocol: "http" },
    { executable: "connector" },
  ]) {
    assert.throws(() => decodeNativeRuntimeExtensionDiscovery(report(overrides)), TypeError)
  }

  assert.throws(
    () =>
      decodeNativeRuntimeExtensionDiscovery({
        ...(report() as Record<string, unknown>),
        executable: "connector",
      }),
    /unsupported fields/,
  )
})

test("native runtime extension discovery rejects duplicate package ids and malformed rejections", () => {
  const value = report() as {
    packages: unknown[]
    rejected: unknown[]
  }
  value.packages.push(value.packages[0])
  assert.throws(() => decodeNativeRuntimeExtensionDiscovery(value), /unique/)

  const malformed = report() as {
    packages: unknown[]
    rejected: unknown[]
  }
  malformed.rejected = [{ directory: "bad.connector", code: "bad", path: "/private" }]
  assert.throws(() => decodeNativeRuntimeExtensionDiscovery(malformed), /unsupported fields/)

  const duplicateRejections = report() as {
    packages: unknown[]
    rejected: unknown[]
  }
  duplicateRejections.rejected.push(duplicateRejections.rejected[0])
  assert.throws(() => decodeNativeRuntimeExtensionDiscovery(duplicateRejections), /unique/)
})

test("native runtime extension management decodes publisher roots and monotonic revocation metadata", () => {
  assert.deepEqual(
    decodeNativeRuntimeExtensionPublishers([
      {
        publisher: "ideall.official",
        label: "ideall official",
        fingerprint: digest,
        status: "official",
        trustedAt: null,
        revokedAt: null,
        revocationSequence: 3,
        revocationIssuedAt: 100,
        revokedDigestCount: 2,
        keySequence: 1,
        rotatedAt: null,
        retiredKeyCount: 0,
      },
    ]),
    [
      {
        publisher: "ideall.official",
        label: "ideall official",
        fingerprint: digest,
        status: "official",
        trustedAt: null,
        revokedAt: null,
        revocationSequence: 3,
        revocationIssuedAt: 100,
        revokedDigestCount: 2,
        keySequence: 1,
        rotatedAt: null,
        retiredKeyCount: 0,
      },
    ],
  )
  assert.deepEqual(
    decodeNativeRuntimeExtensionPublisherCandidate({
      publisher: "acme.tools",
      label: "Acme Tools",
      publicKey: "RWfixture",
      fingerprint: digest,
    }),
    {
      publisher: "acme.tools",
      label: "Acme Tools",
      publicKey: "RWfixture",
      fingerprint: digest,
    },
  )
  assert.throws(
    () =>
      decodeNativeRuntimeExtensionPublishers([
        {
          publisher: "acme.tools",
          label: "Acme",
          fingerprint: digest,
          status: "trusted",
          trustedAt: 1,
          revokedAt: null,
          revocationSequence: null,
          revocationIssuedAt: null,
          revokedDigestCount: 0,
          keySequence: 1,
          rotatedAt: null,
          retiredKeyCount: 0,
        },
        {
          publisher: "acme.tools",
          label: "Duplicate",
          fingerprint: digest,
          status: "revoked",
          trustedAt: 1,
          revokedAt: 2,
          revocationSequence: null,
          revocationIssuedAt: null,
          revokedDigestCount: 0,
          keySequence: 1,
          rotatedAt: null,
          retiredKeyCount: 0,
        },
      ]),
    /unique/,
  )
})

test("native runtime extension management strictly decodes publisher key rotation", () => {
  const candidate = {
    publisher: "acme.tools",
    label: "Acme Tools",
    sequence: 2,
    issuedAt: 100,
    currentFingerprint: digest,
    nextFingerprint: `sha256:${"B".repeat(43)}`,
    payload: '{"schemaVersion":1}',
    currentSignature: "untrusted comment\ncurrent",
    nextSignature: "untrusted comment\nnext",
  }
  assert.deepEqual(decodeNativeRuntimeExtensionPublisherRotationCandidate(candidate), candidate)
  assert.deepEqual(
    decodeNativeRuntimeExtensionPublisherRotationResult({
      changed: true,
      publisher: "acme.tools",
      sequence: 2,
      previousFingerprint: digest,
      fingerprint: `sha256:${"B".repeat(43)}`,
      rotatedAt: 200,
      retiredKeyCount: 1,
    }).retiredKeyCount,
    1,
  )
  assert.throws(() =>
    decodeNativeRuntimeExtensionPublisherRotationCandidate({
      ...candidate,
      nextFingerprint: digest,
    }),
  )
  assert.throws(() =>
    decodeNativeRuntimeExtensionPublisherRotationResult({
      changed: true,
      publisher: "acme.tools",
      sequence: 3,
      previousFingerprint: digest,
      fingerprint: `sha256:${"B".repeat(43)}`,
      rotatedAt: 200,
      retiredKeyCount: 1,
    }),
  )
})

test("native runtime extension management decodes install and revocation results", () => {
  const packageValue = (report() as { packages: unknown[] }).packages[0]
  assert.deepEqual(
    decodeNativeRuntimeExtensionPackageMutation({
      changed: true,
      cancelled: false,
      operation: "updated",
      package: { ...(packageValue as object), rollbackVersion: 2 },
      previousVersion: 2,
    }).operation,
    "updated",
  )
  assert.deepEqual(
    decodeNativeRuntimeExtensionRevocationImport({
      changed: false,
      cancelled: true,
      publisher: null,
      sequence: null,
      revokedDigestCount: 0,
    }),
    {
      changed: false,
      cancelled: true,
      publisher: null,
      sequence: null,
      revokedDigestCount: 0,
    },
  )
})

test("native runtime extension registry decodes a bounded verified snapshot", () => {
  const snapshot = decodeNativeRuntimeExtensionRegistrySnapshot(registrySnapshot())
  assert.equal(snapshot.source, "network")
  assert.equal(snapshot.sequence, 4)
  assert.equal(snapshot.entries[0].id, "acme.search")
})

test("native runtime extension registry rejects unsafe URLs, fields and ordering", () => {
  for (const overrides of [
    { packageUrl: "http://downloads.example.test/package" },
    { packageUrl: "https://user:secret@example.test/package" },
    { packageUrl: "https://example.test/package?token=secret" },
    { permissions: ["tools:invoke", "resources:read"] },
    { packageSha256: "A".repeat(64) },
    { unexpected: true },
  ]) {
    assert.throws(() => decodeNativeRuntimeExtensionRegistrySnapshot(registrySnapshot(overrides)))
  }

  const duplicate = registrySnapshot() as { entries: unknown[] }
  duplicate.entries.push(duplicate.entries[0])
  assert.throws(() => decodeNativeRuntimeExtensionRegistrySnapshot(duplicate), /uniquely ordered/)
})
