import assert from "node:assert/strict"
import { test } from "node:test"
import {
  decodeAppearanceSettings,
  decodeConnectionSettings,
  decodeDeviceSettings,
  decodeRuntimeExtensionSettings,
  decodeSettingsMutationResult,
} from "./settings-contract"

test("settings contract decodes the four bounded JSON projections", () => {
  assert.deepEqual(
    decodeAppearanceSettings({ choice: "system", effectiveColorScheme: "dark", ignored: true }),
    { choice: "system", effectiveColorScheme: "dark" },
  )
  assert.deepEqual(
    decodeDeviceSettings({
      sync: { enabled: true },
      storage: { usage: 10, quota: 100 },
      publishingIdentity: {
        signedIn: true,
        user: { id: 1, email: "user@example.test", name: "User", avatar: null, token: "drop" },
      },
    }),
    {
      sync: { enabled: true },
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
