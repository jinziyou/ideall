import assert from "node:assert/strict"
import { test } from "node:test"
import {
  decodeAppearanceSettings,
  decodeConnectionSettings,
  decodeDataSettings,
  decodeDeviceSettings,
  decodeRuntimeExtensionSettings,
  decodeRuntimeExtensionPublisherRotationCandidate,
  decodeRuntimeExtensionUpdateCandidate,
  decodeSettingsMutationResult,
  decodeSettingsDataExportResult,
  decodeSettingsDataImportPreview,
  decodeSettingsDataImportResult,
  decodeSettingsDataPersistenceResult,
  decodeSettingsDataSecureStoreSelfTestResult,
} from "./settings-contract"

test("settings contract decodes the five bounded JSON projections", () => {
  assert.deepEqual(
    decodeDataSettings({
      archive: {
        kind: "ideall.workspace-archive",
        version: 2,
        includesSecrets: false,
        importMode: "replace",
      },
      secureStore: {
        backend: "system-keychain",
        native: true,
        fallbackValueCount: 0,
        legacyValueCount: 1,
        error: null,
        internal: "drop",
      },
      database: {
        name: "wonita-home",
        version: 17,
        status: "healthy",
        counts: {
          nodes: 2,
          blobs: 1,
          trashSnapshots: 0,
          agentTasks: 1,
          agentWriteAudits: 0,
        },
        error: null,
      },
      storage: { persistenceAvailable: true, persisted: false },
    }),
    {
      archive: {
        kind: "ideall.workspace-archive",
        version: 2,
        includesSecrets: false,
        importMode: "replace",
      },
      secureStore: {
        backend: "system-keychain",
        native: true,
        fallbackValueCount: 0,
        legacyValueCount: 1,
        error: null,
      },
      database: {
        name: "wonita-home",
        version: 17,
        status: "healthy",
        counts: {
          nodes: 2,
          blobs: 1,
          trashSnapshots: 0,
          agentTasks: 1,
          agentWriteAudits: 0,
        },
        error: null,
      },
      storage: { persistenceAvailable: true, persisted: false },
    },
  )
  assert.deepEqual(
    decodeAppearanceSettings({ choice: "system", effectiveColorScheme: "dark", ignored: true }),
    { choice: "system", effectiveColorScheme: "dark" },
  )
  assert.deepEqual(
    decodeDeviceSettings({
      sync: {
        enabled: true,
        lastRun: {
          status: "success",
          finishedAt: 100,
          durationMs: 20,
          total: 3,
          added: 1,
          failureCode: null,
        },
      },
      storage: { usage: 10, quota: 100 },
      publishingIdentity: {
        signedIn: true,
        user: {
          id: `u:${"1".repeat(32)}`,
          email: "user@example.test",
          name: "User",
          avatar: null,
          token: "drop",
        },
      },
    }),
    {
      sync: {
        enabled: true,
        lastRun: {
          status: "success",
          finishedAt: 100,
          durationMs: 20,
          total: 3,
          added: 1,
          failureCode: null,
        },
      },
      storage: { usage: 10, quota: 100 },
      publishingIdentity: {
        signedIn: true,
        user: {
          id: `u:${"1".repeat(32)}`,
          email: "user@example.test",
          name: "User",
          avatar: null,
        },
      },
    },
  )
  assert.deepEqual(
    decodeConnectionSettings([
      {
        id: "connection-1",
        appId: "app-1",
        name: "Example",
        origin: "https://example.test",
        permissions: ["fs:read"],
        grantedAt: 10,
        revoke: "must not cross",
      },
    ]),
    [
      {
        id: "connection-1",
        appId: "app-1",
        name: "Example",
        origin: "https://example.test",
        permissions: ["fs:read"],
        grantedAt: 10,
      },
    ],
  )

  assert.throws(
    () =>
      decodeDeviceSettings({
        sync: { enabled: false, lastRun: null },
        storage: null,
        publishingIdentity: {
          signedIn: true,
          user: { id: 1, email: "legacy@example.test", name: "Legacy", avatar: null },
        },
      }),
    /Publishing identity user id/,
  )
  assert.deepEqual(
    decodeRuntimeExtensionSettings({
      nativeAvailable: true,
      extensions: [
        {
          id: "extension-1",
          label: "Example",
          version: 1,
          source: { kind: "package", id: "package-1", location: "drop" },
          publisherFingerprint: `sha256:${"A".repeat(43)}`,
          permissions: ["fs:read"],
          digest: "digest",
          permissionDigest: "permission-digest",
          verification: { verifierId: "host-verifier", verifiedAt: 10 },
          grantedAt: 11,
          desired: true,
          health: "active",
          failure: null,
          pendingCleanup: [],
          rollbackVersion: 1,
          consentReceipt: "drop",
        },
      ],
      publishers: [
        {
          publisher: "package-1",
          label: "Package One",
          fingerprint: `sha256:${"A".repeat(43)}`,
          status: "trusted",
          trustedAt: 9,
          revokedAt: null,
          revocationSequence: 2,
          revocationIssuedAt: 8,
          revokedDigestCount: 1,
          keySequence: 1,
          rotatedAt: null,
          retiredKeyCount: 0,
        },
      ],
      registry: {
        status: "current",
        source: "network",
        fetchedAt: 20,
        generatedAt: 19,
        expiresAt: 30,
        sequence: 3,
        failureCode: null,
        entries: [
          {
            id: "acme.search",
            label: "Acme Search",
            summary: "Search local resources.",
            version: 2,
            publisher: "package-1",
            publisherFingerprint: `sha256:${"A".repeat(43)}`,
            permissions: ["resources:read"],
            digest: `sha256:${"B".repeat(43)}`,
            packageUrl: "https://downloads.example.test/acme.search.ideall-extension",
            packageSha256: "a".repeat(64),
            publishedAt: 18,
            ignored: true,
          },
        ],
      },
    }),
    {
      nativeAvailable: true,
      extensions: [
        {
          id: "extension-1",
          label: "Example",
          version: 1,
          source: { kind: "package", id: "package-1" },
          publisherFingerprint: `sha256:${"A".repeat(43)}`,
          permissions: ["fs:read"],
          digest: "digest",
          permissionDigest: "permission-digest",
          verification: { verifierId: "host-verifier", verifiedAt: 10 },
          grantedAt: 11,
          desired: true,
          health: "active",
          failure: null,
          pendingCleanup: [],
          rollbackVersion: 1,
        },
      ],
      publishers: [
        {
          publisher: "package-1",
          label: "Package One",
          fingerprint: `sha256:${"A".repeat(43)}`,
          status: "trusted",
          trustedAt: 9,
          revokedAt: null,
          revocationSequence: 2,
          revocationIssuedAt: 8,
          revokedDigestCount: 1,
          keySequence: 1,
          rotatedAt: null,
          retiredKeyCount: 0,
        },
      ],
      registry: {
        status: "current",
        source: "network",
        fetchedAt: 20,
        generatedAt: 19,
        expiresAt: 30,
        sequence: 3,
        failureCode: null,
        entries: [
          {
            id: "acme.search",
            label: "Acme Search",
            summary: "Search local resources.",
            version: 2,
            publisher: "package-1",
            publisherFingerprint: `sha256:${"A".repeat(43)}`,
            permissions: ["resources:read"],
            digest: `sha256:${"B".repeat(43)}`,
            packageUrl: "https://downloads.example.test/acme.search.ideall-extension",
            packageSha256: "a".repeat(64),
            publishedAt: 18,
          },
        ],
      },
    },
  )
  assert.deepEqual(decodeSettingsMutationResult({ changed: true, secret: "drop" }), {
    changed: true,
  })
  assert.deepEqual(
    decodeSettingsDataExportResult({
      filename: "archive.json",
      content: "{}",
      encrypted: true,
      ignored: true,
    }),
    { filename: "archive.json", content: "{}", encrypted: true },
  )
  assert.deepEqual(
    decodeSettingsDataImportPreview({
      ok: true,
      encrypted: true,
      requiresPassphrase: false,
      filename: "archive.json",
      error: null,
      package: { kind: "ideall.workspace-archive", version: 1, exportedAt: "2026-01-01" },
      archive: {
        nodeCount: 2,
        blobCount: 1,
        trashSnapshotCount: 0,
        pluginCount: 3,
        tabCount: 1,
      },
    }).archive?.pluginCount,
    3,
  )
  assert.deepEqual(
    decodeSettingsDataImportResult({
      changed: true,
      reloadRequired: true,
      imported: { nodes: 2, blobs: 1, trash: 0, plugins: 3 },
    }).imported,
    { nodes: 2, blobs: 1, trash: 0, plugins: 3 },
  )
  assert.deepEqual(
    decodeSettingsDataPersistenceResult({ available: true, granted: false, ignored: true }),
    { available: true, granted: false },
  )
  assert.deepEqual(
    decodeSettingsDataSecureStoreSelfTestResult({
      backend: "system-keychain",
      roundTrip: true,
      cleanedUp: true,
    }),
    { backend: "system-keychain", roundTrip: true, cleanedUp: true },
  )
})

test("settings contract rejects malformed or unbounded projections", () => {
  assert.throws(
    () => decodeAppearanceSettings({ choice: "sepia", effectiveColorScheme: "dark" }),
    /choice is invalid/,
  )
  assert.throws(
    () =>
      decodeDeviceSettings({
        sync: { enabled: "yes" },
        storage: null,
        publishingIdentity: { signedIn: false, user: null },
      }),
    /sync state is invalid/,
  )
  assert.throws(() => decodeConnectionSettings({}), /must be an array/)
  assert.throws(
    () =>
      decodeDataSettings({
        archive: {
          kind: "ideall.workspace-archive",
          version: 1,
          includesSecrets: true,
          importMode: "replace",
        },
        secureStore: {
          backend: "unavailable",
          native: false,
          fallbackValueCount: 0,
          legacyValueCount: 0,
          error: null,
        },
        database: {
          name: "wonita-home",
          version: 17,
          status: "healthy",
          counts: {
            nodes: 0,
            blobs: 0,
            trashSnapshots: 0,
            agentTasks: 0,
            agentWriteAudits: 0,
          },
          error: null,
        },
        storage: { persistenceAvailable: true, persisted: false },
      }),
    /archive policy is invalid/,
  )
  assert.throws(
    () =>
      decodeRuntimeExtensionSettings({
        nativeAvailable: false,
        extensions: [
          {
            id: "extension-1",
            label: "Example",
            version: 1,
            source: null,
            publisherFingerprint: null,
            permissions: [],
            digest: "digest",
            permissionDigest: "permission-digest",
            verification: null,
            grantedAt: null,
            desired: true,
            health: "compromised",
            failure: null,
            pendingCleanup: [],
            rollbackVersion: null,
          },
        ],
        publishers: [],
      }),
    /health is invalid/,
  )
  assert.throws(() => decodeSettingsMutationResult({ changed: "yes" }), /result is invalid/)
})

test("settings contract decodes bounded publisher rotation candidates", () => {
  const value = {
    publisher: "acme.tools",
    label: "Acme Tools",
    sequence: 2,
    issuedAt: 100,
    currentFingerprint: `sha256:${"A".repeat(43)}`,
    nextFingerprint: `sha256:${"B".repeat(43)}`,
    payload: '{"schemaVersion":1}',
    currentSignature: "current\nsignature",
    nextSignature: "next\nsignature",
  }
  assert.deepEqual(decodeRuntimeExtensionPublisherRotationCandidate(value), value)
  assert.throws(() =>
    decodeRuntimeExtensionPublisherRotationCandidate({
      ...value,
      nextFingerprint: value.currentFingerprint,
    }),
  )
})

test("settings contract decodes a bound extension update candidate", () => {
  const value = {
    token: "123e4567-e89b-42d3-a456-426614174000",
    registrySequence: 4,
    registryExpiresAt: 300,
    id: "acme.search",
    label: "Acme Search",
    currentVersion: 2,
    nextVersion: 3,
    publisher: "acme.tools",
    publisherFingerprint: `sha256:${"A".repeat(43)}`,
    currentPermissions: ["resources:read"],
    nextPermissions: ["resources:read", "tools:invoke"],
    addedPermissions: ["tools:invoke"],
    removedPermissions: [],
    digest: `sha256:${"B".repeat(43)}`,
    packageSha256: "a".repeat(64),
    publishedAt: 100,
  }
  assert.deepEqual(decodeRuntimeExtensionUpdateCandidate(value), value)
  assert.throws(() =>
    decodeRuntimeExtensionUpdateCandidate({ ...value, removedPermissions: ["resources:read"] }),
  )
  assert.throws(() => decodeRuntimeExtensionUpdateCandidate({ ...value, nextVersion: 1 }))
})
