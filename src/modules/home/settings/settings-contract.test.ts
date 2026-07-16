import assert from "node:assert/strict"
import { test } from "node:test"
import {
  decodeAppearanceSettings,
  decodeConnectionSettings,
  decodeDataSettings,
  decodeDeviceSettings,
  decodeRuntimeExtensionSettings,
  decodeSettingsMutationResult,
  decodeSettingsDataExportResult,
  decodeSettingsDataImportPreview,
  decodeSettingsDataImportResult,
  decodeSettingsDataPersistenceResult,
  decodeSettingsDataSecureStoreSelfTestResult,
  decodeSettingsDataSecureStoreMigrationResult,
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
        counts: { nodes: 2, blobs: 1, trashSnapshots: 0, agentTasks: 1 },
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
        counts: { nodes: 2, blobs: 1, trashSnapshots: 0, agentTasks: 1 },
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
        user: { id: 1, email: "user@example.test", name: "User", avatar: null, token: "drop" },
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
        user: { id: 1, email: "user@example.test", name: "User", avatar: null },
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
  assert.deepEqual(
    decodeRuntimeExtensionSettings([
      {
        id: "extension-1",
        label: "Example",
        version: 1,
        source: { kind: "package", id: "package-1", location: "drop" },
        permissions: ["fs:read"],
        digest: "digest",
        permissionDigest: "permission-digest",
        desired: true,
        health: "active",
        failure: null,
        pendingCleanup: [],
        consentReceipt: "drop",
      },
    ]),
    [
      {
        id: "extension-1",
        label: "Example",
        version: 1,
        source: { kind: "package", id: "package-1" },
        permissions: ["fs:read"],
        digest: "digest",
        permissionDigest: "permission-digest",
        desired: true,
        health: "active",
        failure: null,
        pendingCleanup: [],
      },
    ],
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
  assert.deepEqual(
    decodeSettingsDataSecureStoreMigrationResult({
      available: true,
      migrated: 1,
      removedPlaintext: 2,
      failed: 0,
      remaining: 0,
    }),
    { available: true, migrated: 1, removedPlaintext: 2, failed: 0, remaining: 0 },
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
          counts: { nodes: 0, blobs: 0, trashSnapshots: 0, agentTasks: 0 },
          error: null,
        },
        storage: { persistenceAvailable: true, persisted: false },
      }),
    /archive policy is invalid/,
  )
  assert.throws(
    () =>
      decodeRuntimeExtensionSettings([
        {
          id: "extension-1",
          label: "Example",
          version: 1,
          source: null,
          permissions: [],
          digest: "digest",
          permissionDigest: "permission-digest",
          desired: true,
          health: "compromised",
          failure: null,
          pendingCleanup: [],
        },
      ]),
    /health is invalid/,
  )
  assert.throws(() => decodeSettingsMutationResult({ changed: "yes" }), /result is invalid/)
})
