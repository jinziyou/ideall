import assert from "node:assert/strict"
import { test } from "node:test"
import { FileSystemError } from "@/filesystem/types"
import { setThemeChoice } from "@/lib/theme"
import {
  SETTINGS_CONNECTION_REVOKE_ACTION,
  SETTINGS_DATA_EXPORT_ACTION,
  SETTINGS_DATA_IMPORT_ACTION,
  SETTINGS_DATA_MIGRATE_SECURE_STORE_ACTION,
  SETTINGS_DATA_PERSIST_ACTION,
  SETTINGS_DATA_PREVIEW_IMPORT_ACTION,
  SETTINGS_DATA_SECURE_STORE_SELF_TEST_ACTION,
  SETTINGS_READ_PERMISSION,
  SETTINGS_ROOT_MEDIA_TYPE,
  SETTINGS_RUNTIME_AUTHORIZE_ACTION,
  SETTINGS_RUNTIME_APPLY_UPDATE_ACTION,
  SETTINGS_RUNTIME_APPLY_PUBLISHER_ROTATION_ACTION,
  SETTINGS_RUNTIME_DISCARD_UPDATE_ACTION,
  SETTINGS_RUNTIME_IMPORT_REVOCATIONS_ACTION,
  SETTINGS_RUNTIME_INSPECT_PUBLISHER_ACTION,
  SETTINGS_RUNTIME_INSPECT_PUBLISHER_ROTATION_ACTION,
  SETTINGS_RUNTIME_INSTALL_PACKAGE_ACTION,
  SETTINGS_RUNTIME_PREPARE_UPDATE_ACTION,
  SETTINGS_RUNTIME_RETRY_ACTION,
  SETTINGS_RUNTIME_REFRESH_REGISTRY_ACTION,
  SETTINGS_RUNTIME_REVOKE_PUBLISHER_ACTION,
  SETTINGS_RUNTIME_REVOKE_ACTION,
  SETTINGS_RUNTIME_ROLLBACK_PACKAGE_ACTION,
  SETTINGS_RUNTIME_TRUST_PUBLISHER_ACTION,
  SETTINGS_RUNTIME_UNINSTALL_ACTION,
  SETTINGS_SECTION_IDS,
  SETTINGS_WRITE_PERMISSION,
  createSettingsFileSystem,
  sanitizeSettingsDiagnostic,
  settingsDiagnosticMessage,
  settingsFileSystem,
  settingsRootRef,
  settingsRuntimeExtensionSnapshot,
  settingsSectionFileRef,
  type SettingsFileSystemDeps,
  type SettingsRuntimeAction,
  type SettingsSectionId,
} from "./settings-file-system"

function createFixture(
  options: {
    writeAppearance?: () => void
    revokeConnection?: (id: string) => boolean
    manageRuntimeExtension?: (action: SettingsRuntimeAction, id: string) => boolean
    importWorkspaceArchive?: () => void
  } = {},
) {
  const state: Record<SettingsSectionId, unknown> = {
    appearance: { choice: "light", effectiveColorScheme: "light" },
    device: {
      sync: { enabled: true, lastRun: null },
      storage: { usage: 10, quota: 100 },
      publishingIdentity: { signedIn: false, user: null },
    },
    data: {
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
        legacyValueCount: 0,
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
    connections: [
      {
        id: "connection-1",
        name: "Example",
        revoke() {
          throw new Error("must never cross the file boundary")
        },
      },
    ],
    "runtime-extensions": [
      { id: "extension-1", health: "active", failure: new Error("diagnostic") },
    ],
  }
  const reads: SettingsSectionId[] = []
  const writes: string[] = []
  const connectionRevocations: string[] = []
  const runtimeActions: Array<{ action: SettingsRuntimeAction; id: string }> = []
  const runtimeHostActions: Array<{ action: string; input?: unknown }> = []
  const archiveImports: Array<{ content: string; filename?: string; passphrase?: string }> = []
  const listeners = new Map<SettingsSectionId, Set<() => void>>()
  const subscriptions = new Map<SettingsSectionId, number>()
  const deps: SettingsFileSystemDeps = {
    read(section) {
      reads.push(section)
      return state[section]
    },
    writeAppearance(choice) {
      if (options.writeAppearance) return options.writeAppearance()
      writes.push(choice)
      state.appearance = { choice, effectiveColorScheme: choice }
    },
    exportWorkspaceArchive() {
      return {
        filename: "workspace.json",
        content: '{"kind":"ideall.workspace-archive"}',
        encrypted: false,
      }
    },
    previewWorkspaceArchive(content, filename) {
      return {
        ok: content.includes("ideall.workspace-archive"),
        encrypted: false,
        requiresPassphrase: false,
        filename: filename ?? null,
        error: null,
        package: { kind: "ideall.workspace-archive", version: 1, exportedAt: "2026-01-01" },
        archive: {
          nodeCount: 2,
          blobCount: 1,
          trashSnapshotCount: 0,
          pluginCount: 3,
          tabCount: 1,
        },
      }
    },
    importWorkspaceArchive(content, filename, passphrase) {
      archiveImports.push({
        content,
        ...(filename ? { filename } : {}),
        ...(passphrase ? { passphrase } : {}),
      })
      options.importWorkspaceArchive?.()
      return {
        changed: true,
        reloadRequired: true,
        imported: { nodes: 2, blobs: 1, trash: 0, plugins: 3 },
      }
    },
    requestPersistentStorage() {
      return { available: true, granted: true }
    },
    selfTestSecureStore() {
      return { backend: "system-keychain", roundTrip: true, cleanedUp: true }
    },
    migrateSecureStore() {
      return { available: true, migrated: 1, removedPlaintext: 1, failed: 0, remaining: 0 }
    },
    revokeConnection(id) {
      connectionRevocations.push(id)
      return options.revokeConnection?.(id) ?? true
    },
    manageRuntimeExtension(action, id) {
      runtimeActions.push({ action, id })
      return options.manageRuntimeExtension?.(action, id) ?? true
    },
    inspectRuntimeExtensionPublisher() {
      runtimeHostActions.push({ action: "inspect-publisher" })
      return {
        publisher: "acme.tools",
        label: "Acme Tools",
        publicKey: "RWfixture",
        fingerprint: `sha256:${"A".repeat(43)}`,
      }
    },
    inspectRuntimeExtensionPublisherRotation() {
      runtimeHostActions.push({ action: "inspect-publisher-rotation" })
      return {
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
    },
    applyRuntimeExtensionPublisherRotation(candidate) {
      runtimeHostActions.push({ action: "apply-publisher-rotation", input: candidate })
      return {
        changed: true,
        publisher: candidate.publisher,
        sequence: candidate.sequence,
        previousFingerprint: candidate.currentFingerprint,
        fingerprint: candidate.nextFingerprint,
        rotatedAt: 200,
        retiredKeyCount: 1,
      }
    },
    trustRuntimeExtensionPublisher(candidate) {
      runtimeHostActions.push({ action: "trust-publisher", input: candidate })
      return true
    },
    revokeRuntimeExtensionPublisher(publisher, fingerprint) {
      runtimeHostActions.push({ action: "revoke-publisher", input: { publisher, fingerprint } })
      return true
    },
    importRuntimeExtensionRevocations() {
      runtimeHostActions.push({ action: "import-revocations" })
      return { changed: true, cancelled: false, publisher: "acme.tools", sequence: 2 }
    },
    installRuntimeExtensionPackage() {
      runtimeHostActions.push({ action: "install-package" })
      return { changed: true, cancelled: false, operation: "installed" }
    },
    prepareRuntimeExtensionUpdate(id) {
      const candidate = {
        token: "123e4567-e89b-42d3-a456-426614174000",
        registrySequence: 2,
        registryExpiresAt: 300,
        id,
        label: "Extension update",
        currentVersion: 1,
        nextVersion: 2,
        publisher: "acme.tools",
        publisherFingerprint: `sha256:${"A".repeat(43)}`,
        currentPermissions: ["resources:read"] as const,
        nextPermissions: ["resources:read", "tools:invoke"] as const,
        addedPermissions: ["tools:invoke"] as const,
        removedPermissions: [],
        digest: `sha256:${"B".repeat(43)}`,
        packageSha256: "a".repeat(64),
        publishedAt: 100,
      }
      runtimeHostActions.push({ action: "prepare-update", input: { id } })
      return candidate
    },
    applyRuntimeExtensionUpdate(candidate) {
      runtimeHostActions.push({ action: "apply-update", input: candidate })
      return { changed: true, cancelled: false, operation: "updated" }
    },
    discardRuntimeExtensionUpdate(token) {
      runtimeHostActions.push({ action: "discard-update", input: { token } })
      return true
    },
    rollbackRuntimeExtensionPackage(id) {
      runtimeHostActions.push({ action: "rollback-package", input: { id } })
      return { changed: true, cancelled: false, operation: "rolled-back" }
    },
    refreshRuntimeExtensionRegistry() {
      runtimeHostActions.push({ action: "refresh-registry" })
      return {
        source: "network" as const,
        stale: false,
        fetchedAt: 200,
        generatedAt: 100,
        expiresAt: 300,
        sequence: 2,
        failureCode: null,
        entries: [],
      }
    },
    subscribe(section, listener) {
      let current = listeners.get(section)
      if (!current) {
        current = new Set()
        listeners.set(section, current)
      }
      current.add(listener)
      subscriptions.set(section, (subscriptions.get(section) ?? 0) + 1)
      return () => {
        current?.delete(listener)
        subscriptions.set(section, (subscriptions.get(section) ?? 1) - 1)
      }
    },
  }
  return {
    fs: createSettingsFileSystem(deps),
    state,
    reads,
    writes,
    connectionRevocations,
    runtimeActions,
    runtimeHostActions,
    archiveImports,
    subscriptions,
    emit(section: SettingsSectionId) {
      for (const listener of listeners.get(section) ?? []) listener()
    },
  }
}

const UI_METADATA = { actor: "ui", permissions: [], intent: "metadata" } as const
const UI_DIRECTORY = { actor: "ui", permissions: [], intent: "directory" } as const
const UI_CONTENT = { actor: "ui", permissions: [], intent: "content" } as const
const UI_WRITE = { actor: "ui", permissions: [], intent: "write" } as const
const UI_ACTION = { actor: "ui", permissions: [], intent: "action" } as const
const UI_WATCH = { actor: "ui", permissions: [], intent: "watch" } as const

test("settings filesystem: semantic root projects five stable snapshot files without reading them", async () => {
  const fixture = createFixture()
  const root = await fixture.fs.stat(settingsRootRef, UI_METADATA)

  assert.ok(root)
  assert.equal(root.kind, "directory")
  assert.equal(root.mediaType, SETTINGS_ROOT_MEDIA_TYPE)
  assert.equal(root.properties?.settingsRoot, true)
  assert.deepEqual(fixture.reads, [])

  const first = await fixture.fs.readDirectory(settingsRootRef, UI_DIRECTORY, { limit: 2 })
  const second = await fixture.fs.readDirectory(settingsRootRef, UI_DIRECTORY, {
    cursor: first.nextCursor,
    limit: 3,
  })
  const entries = [...first.entries, ...second.entries]
  assert.deepEqual(
    entries.map((entry) => entry.entryId),
    SETTINGS_SECTION_IDS,
  )
  assert.deepEqual(
    entries.map((entry) => entry.pathName),
    ["appearance.json", "device.json", "data.json", "connections.json", "runtime-extensions.json"],
  )
  assert.deepEqual(
    entries.map((entry) => entry.target),
    SETTINGS_SECTION_IDS.map(settingsSectionFileRef),
  )
  assert.ok(entries.every((entry) => entry.file?.properties?.synthetic === true))
  assert.deepEqual(fixture.reads, [], "directory listing must not collect host diagnostics")
})

test("settings filesystem: fs:read metadata cannot fingerprint private section snapshots", async () => {
  const fixture = createFixture()
  const ref = settingsSectionFileRef("connections")
  const structural = await fixture.fs.stat(ref, {
    actor: "system",
    permissions: ["fs:read"],
    intent: "metadata",
  })

  assert.ok(structural)
  assert.equal(structural.size, undefined)
  assert.equal(structural.version, undefined)
  assert.deepEqual(fixture.reads, [])

  const privileged = await fixture.fs.stat(ref, {
    actor: "system",
    permissions: ["fs:read", SETTINGS_READ_PERMISSION],
    intent: "metadata",
  })
  assert.ok(privileged)
  assert.equal(typeof privileged.size, "number")
  assert.equal(typeof privileged.version, "string")
  assert.deepEqual(fixture.reads, ["connections"])

  await assert.rejects(
    fixture.fs.read(ref, { actor: "system", permissions: ["fs:read"], intent: "content" }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )

  const content = await fixture.fs.read(ref, {
    actor: "system",
    permissions: [SETTINGS_READ_PERMISSION],
    intent: "content",
  })
  assert.deepEqual(content.data, [{ id: "connection-1", name: "Example" }])
  assert.equal(JSON.stringify(content.data).includes("revoke"), false)

  assert.deepEqual(
    (
      await fixture.fs.read(ref, {
        actor: "engine",
        permissions: [],
        activeFile: ref,
        intent: "content",
      })
    ).data,
    content.data,
  )
  await assert.rejects(
    fixture.fs.read(ref, {
      actor: "engine",
      permissions: [],
      activeFile: settingsSectionFileRef("device"),
      intent: "content",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
})

test("settings filesystem: snapshot versions are deterministic SHA-256 tokens bound to content", async () => {
  const fixture = createFixture()
  const ref = settingsSectionFileRef("device")

  const first = await fixture.fs.read(ref, UI_CONTENT)
  const repeated = await fixture.fs.read(ref, UI_CONTENT)
  const metadata = await fixture.fs.stat(ref, UI_METADATA)

  assert.match(first.version ?? "", /^settings-v2:[0-9a-f]{64}$/)
  assert.equal(repeated.version, first.version)
  assert.equal(metadata?.version, first.version)

  fixture.state.device = {
    ...(fixture.state.device as Record<string, unknown>),
    storage: { usage: 11, quota: 100 },
  }
  const changed = await fixture.fs.read(ref, UI_CONTENT)
  assert.match(changed.version ?? "", /^settings-v2:[0-9a-f]{64}$/)
  assert.notEqual(changed.version, first.version)
})

test("settings filesystem: appearance is the only writable section and honors versions", async () => {
  const fixture = createFixture()
  const appearance = settingsSectionFileRef("appearance")
  const before = await fixture.fs.read(appearance, UI_CONTENT)

  const changed = await fixture.fs.write(
    appearance,
    { data: { choice: "dark" }, expectedVersion: before.version },
    UI_WRITE,
  )
  assert.deepEqual(fixture.writes, ["dark"])
  assert.notEqual(changed.version, before.version)
  assert.deepEqual((await fixture.fs.read(appearance, UI_CONTENT)).data, {
    choice: "dark",
    effectiveColorScheme: "dark",
  })

  await assert.rejects(
    fixture.fs.write(
      appearance,
      { data: { choice: "system" }, expectedVersion: before.version },
      UI_WRITE,
    ),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.deepEqual(fixture.writes, ["dark"], "stale versions must not reach the backend")
  await assert.rejects(
    fixture.fs.write(settingsSectionFileRef("device"), { data: {} }, UI_WRITE),
    (error) => error instanceof FileSystemError && error.code === "unsupported",
  )
  await assert.rejects(
    fixture.fs.write(appearance, { data: { choice: "sepia" } }, UI_WRITE),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  await assert.rejects(
    fixture.fs.write(
      appearance,
      { data: { choice: "light" } },
      {
        actor: "system",
        permissions: ["fs:write"],
        intent: "write",
      },
    ),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  await fixture.fs.write(
    appearance,
    { data: { choice: "light" } },
    {
      actor: "system",
      permissions: [SETTINGS_WRITE_PERMISSION],
      intent: "write",
    },
  )
})

test("settings filesystem: mutation actions are specialized, validated and require settings:write", async () => {
  const fixture = createFixture()
  const connections = settingsSectionFileRef("connections")
  const runtime = settingsSectionFileRef("runtime-extensions")

  const connectionActions = await fixture.fs.actions(connections, UI_ACTION)
  assert.deepEqual(
    connectionActions.map(({ id, kind }) => ({ id, kind })),
    [
      { id: "open", kind: "display" },
      { id: SETTINGS_CONNECTION_REVOKE_ACTION, kind: "specialized" },
    ],
  )
  const runtimeActions = await fixture.fs.actions(runtime, UI_ACTION)
  assert.deepEqual(
    runtimeActions.slice(1).map(({ id, kind, requires }) => ({ id, kind, requires })),
    [
      {
        id: SETTINGS_RUNTIME_REFRESH_REGISTRY_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_INSTALL_PACKAGE_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_PREPARE_UPDATE_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_APPLY_UPDATE_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_DISCARD_UPDATE_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_INSPECT_PUBLISHER_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_TRUST_PUBLISHER_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_INSPECT_PUBLISHER_ROTATION_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_APPLY_PUBLISHER_ROTATION_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_REVOKE_PUBLISHER_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_IMPORT_REVOCATIONS_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_AUTHORIZE_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_RETRY_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_REVOKE_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_ROLLBACK_PACKAGE_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_RUNTIME_UNINSTALL_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
    ],
  )

  assert.deepEqual(
    await fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_REFRESH_REGISTRY_ACTION,
      undefined,
      UI_ACTION,
    ),
    {
      source: "network",
      stale: false,
      fetchedAt: 200,
      generatedAt: 100,
      expiresAt: 300,
      sequence: 2,
      failureCode: null,
      entries: [],
    },
  )
  assert.deepEqual(
    await fixture.fs.invoke(
      connections,
      SETTINGS_CONNECTION_REVOKE_ACTION,
      { id: "connection-1" },
      UI_ACTION,
    ),
    { changed: true },
  )
  for (const action of [
    SETTINGS_RUNTIME_AUTHORIZE_ACTION,
    SETTINGS_RUNTIME_RETRY_ACTION,
    SETTINGS_RUNTIME_REVOKE_ACTION,
    SETTINGS_RUNTIME_UNINSTALL_ACTION,
  ] as const) {
    assert.deepEqual(await fixture.fs.invoke(runtime, action, { id: "extension-1" }, UI_ACTION), {
      changed: true,
    })
  }
  assert.deepEqual(fixture.connectionRevocations, ["connection-1"])
  assert.deepEqual(fixture.runtimeActions, [
    { action: SETTINGS_RUNTIME_AUTHORIZE_ACTION, id: "extension-1" },
    { action: SETTINGS_RUNTIME_RETRY_ACTION, id: "extension-1" },
    { action: SETTINGS_RUNTIME_REVOKE_ACTION, id: "extension-1" },
    { action: SETTINGS_RUNTIME_UNINSTALL_ACTION, id: "extension-1" },
  ])

  await assert.rejects(
    fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_RETRY_ACTION,
      { id: "extension-1" },
      { actor: "engine", permissions: [], activeFile: runtime, intent: "action" },
    ),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  assert.deepEqual(
    await fixture.fs.invoke(
      connections,
      SETTINGS_CONNECTION_REVOKE_ACTION,
      { id: "connection-system" },
      {
        actor: "system",
        permissions: [SETTINGS_WRITE_PERMISSION],
        intent: "action",
      },
    ),
    { changed: true },
  )
  await assert.rejects(
    fixture.fs.invoke(
      connections,
      SETTINGS_CONNECTION_REVOKE_ACTION,
      { id: "connection-1", extra: true },
      UI_ACTION,
    ),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  await assert.rejects(
    fixture.fs.invoke(connections, SETTINGS_RUNTIME_RETRY_ACTION, { id: "extension-1" }, UI_ACTION),
    (error) => error instanceof FileSystemError && error.code === "unsupported",
  )
})

test("settings filesystem: native extension management validates trust and package action inputs", async () => {
  const fixture = createFixture()
  const runtime = settingsSectionFileRef("runtime-extensions")
  const fingerprint = `sha256:${"A".repeat(43)}`
  const candidate = {
    publisher: "acme.tools",
    label: "Acme Tools",
    publicKey: "RWfixture",
    fingerprint,
  }
  const rotationCandidate = {
    publisher: "acme.tools",
    label: "Acme Tools",
    sequence: 2,
    issuedAt: 100,
    currentFingerprint: fingerprint,
    nextFingerprint: `sha256:${"B".repeat(43)}`,
    payload: '{"schemaVersion":1}',
    currentSignature: "current\nsignature",
    nextSignature: "next\nsignature",
  }

  assert.deepEqual(
    await fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_INSPECT_PUBLISHER_ACTION,
      undefined,
      UI_ACTION,
    ),
    candidate,
  )
  assert.deepEqual(
    await fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_INSPECT_PUBLISHER_ROTATION_ACTION,
      undefined,
      UI_ACTION,
    ),
    rotationCandidate,
  )
  assert.deepEqual(
    await fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_APPLY_PUBLISHER_ROTATION_ACTION,
      rotationCandidate,
      UI_ACTION,
    ),
    {
      changed: true,
      publisher: "acme.tools",
      sequence: 2,
      previousFingerprint: fingerprint,
      fingerprint: `sha256:${"B".repeat(43)}`,
      rotatedAt: 200,
      retiredKeyCount: 1,
    },
  )
  assert.deepEqual(
    await fixture.fs.invoke(runtime, SETTINGS_RUNTIME_TRUST_PUBLISHER_ACTION, candidate, UI_ACTION),
    { changed: true },
  )
  assert.deepEqual(
    await fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_REVOKE_PUBLISHER_ACTION,
      { publisher: candidate.publisher, fingerprint },
      UI_ACTION,
    ),
    { changed: true },
  )
  assert.deepEqual(
    await fixture.fs.invoke(runtime, SETTINGS_RUNTIME_INSTALL_PACKAGE_ACTION, undefined, UI_ACTION),
    { changed: true, cancelled: false, operation: "installed" },
  )
  const updateCandidate = (await fixture.fs.invoke(
    runtime,
    SETTINGS_RUNTIME_PREPARE_UPDATE_ACTION,
    { id: "extension-1" },
    UI_ACTION,
  )) as Record<string, unknown>
  assert.equal(updateCandidate.nextVersion, 2)
  assert.deepEqual(
    await fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_APPLY_UPDATE_ACTION,
      updateCandidate,
      UI_ACTION,
    ),
    { changed: true, cancelled: false, operation: "updated" },
  )
  assert.deepEqual(
    await fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_DISCARD_UPDATE_ACTION,
      { token: updateCandidate.token },
      UI_ACTION,
    ),
    { changed: true },
  )
  assert.deepEqual(
    await fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_IMPORT_REVOCATIONS_ACTION,
      undefined,
      UI_ACTION,
    ),
    { changed: true, cancelled: false, publisher: "acme.tools", sequence: 2 },
  )
  assert.deepEqual(
    await fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_ROLLBACK_PACKAGE_ACTION,
      { id: "extension-1" },
      UI_ACTION,
    ),
    { changed: true, cancelled: false, operation: "rolled-back" },
  )
  assert.deepEqual(
    fixture.runtimeHostActions.map((item) => item.action),
    [
      "inspect-publisher",
      "inspect-publisher-rotation",
      "apply-publisher-rotation",
      "trust-publisher",
      "revoke-publisher",
      "install-package",
      "prepare-update",
      "apply-update",
      "discard-update",
      "import-revocations",
      "rollback-package",
    ],
  )

  await assert.rejects(
    fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_TRUST_PUBLISHER_ACTION,
      { ...candidate, fingerprint: "sha256:short" },
      UI_ACTION,
    ),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  await assert.rejects(
    fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_APPLY_PUBLISHER_ROTATION_ACTION,
      { ...rotationCandidate, nextSignature: "" },
      UI_ACTION,
    ),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  await assert.rejects(
    fixture.fs.invoke(runtime, SETTINGS_RUNTIME_INSTALL_PACKAGE_ACTION, {}, UI_ACTION),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  await assert.rejects(
    fixture.fs.invoke(
      runtime,
      SETTINGS_RUNTIME_APPLY_UPDATE_ACTION,
      { ...updateCandidate, addedPermissions: [] },
      UI_ACTION,
    ),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
})

test("settings filesystem: local data archive actions separate preview/export from destructive import", async () => {
  const fixture = createFixture()
  const data = settingsSectionFileRef("data")
  const actions = await fixture.fs.actions(data, UI_ACTION)

  assert.deepEqual(
    actions.slice(1).map(({ id, risk, requires }) => ({ id, risk, requires })),
    [
      {
        id: SETTINGS_DATA_EXPORT_ACTION,
        risk: "safe",
        requires: [SETTINGS_READ_PERMISSION],
      },
      {
        id: SETTINGS_DATA_PREVIEW_IMPORT_ACTION,
        risk: "safe",
        requires: [SETTINGS_READ_PERMISSION],
      },
      {
        id: SETTINGS_DATA_IMPORT_ACTION,
        risk: "destructive",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_DATA_PERSIST_ACTION,
        risk: "caution",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_DATA_SECURE_STORE_SELF_TEST_ACTION,
        risk: "caution",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
      {
        id: SETTINGS_DATA_MIGRATE_SECURE_STORE_ACTION,
        risk: "caution",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
    ],
  )
  assert.deepEqual(
    await fixture.fs.invoke(data, SETTINGS_DATA_EXPORT_ACTION, undefined, UI_ACTION),
    {
      filename: "workspace.json",
      content: '{"kind":"ideall.workspace-archive"}',
      encrypted: false,
    },
  )
  const input = {
    filename: "workspace.json",
    content: '{"kind":"ideall.workspace-archive"}',
  }
  assert.equal(
    (
      (await fixture.fs.invoke(data, SETTINGS_DATA_PREVIEW_IMPORT_ACTION, input, UI_ACTION)) as {
        ok: boolean
      }
    ).ok,
    true,
  )
  const before = await fixture.fs.read(data, UI_CONTENT)
  assert.deepEqual(
    await fixture.fs.invoke(data, SETTINGS_DATA_IMPORT_ACTION, input, UI_ACTION, {
      expectedVersion: before.version,
    }),
    {
      changed: true,
      reloadRequired: true,
      imported: { nodes: 2, blobs: 1, trash: 0, plugins: 3 },
    },
  )
  assert.deepEqual(fixture.archiveImports, [input])
  assert.deepEqual(
    await fixture.fs.invoke(data, SETTINGS_DATA_PERSIST_ACTION, undefined, UI_ACTION),
    { available: true, granted: true },
  )
  assert.deepEqual(
    await fixture.fs.invoke(
      data,
      SETTINGS_DATA_SECURE_STORE_SELF_TEST_ACTION,
      undefined,
      UI_ACTION,
    ),
    { backend: "system-keychain", roundTrip: true, cleanedUp: true },
  )
  assert.deepEqual(
    await fixture.fs.invoke(data, SETTINGS_DATA_MIGRATE_SECURE_STORE_ACTION, undefined, UI_ACTION),
    { available: true, migrated: 1, removedPlaintext: 1, failed: 0, remaining: 0 },
  )

  await assert.rejects(
    fixture.fs.invoke(
      data,
      SETTINGS_DATA_PREVIEW_IMPORT_ACTION,
      { content: "{}", extra: true },
      UI_ACTION,
    ),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  await assert.rejects(
    fixture.fs.invoke(data, SETTINGS_DATA_IMPORT_ACTION, input, {
      actor: "system",
      permissions: [SETTINGS_READ_PERMISSION],
      intent: "action",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
})

test("settings filesystem: mutation actions validate fresh versions before touching backends", async () => {
  const fixture = createFixture()
  const ref = settingsSectionFileRef("connections")
  const before = await fixture.fs.read(ref, UI_CONTENT)

  fixture.state.connections = [
    ...(fixture.state.connections as unknown[]),
    { id: "connection-external", name: "External" },
  ]
  await assert.rejects(
    fixture.fs.invoke(
      ref,
      SETTINGS_CONNECTION_REVOKE_ACTION,
      { id: "connection-stale" },
      UI_ACTION,
      { expectedVersion: before.version },
    ),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  await assert.rejects(
    fixture.fs.invoke(
      ref,
      SETTINGS_CONNECTION_REVOKE_ACTION,
      { id: "connection-versionless" },
      UI_ACTION,
      { expectedVersion: null },
    ),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.deepEqual(fixture.connectionRevocations, [])

  const current = await fixture.fs.read(ref, UI_CONTENT)
  assert.deepEqual(
    await fixture.fs.invoke(
      ref,
      SETTINGS_CONNECTION_REVOKE_ACTION,
      { id: "connection-current" },
      UI_ACTION,
      { expectedVersion: current.version },
    ),
    { changed: true },
  )
  assert.deepEqual(
    await fixture.fs.invoke(
      ref,
      SETTINGS_CONNECTION_REVOKE_ACTION,
      { id: "connection-unchecked" },
      UI_ACTION,
      { expectedVersion: undefined },
    ),
    { changed: true },
  )
  assert.deepEqual(fixture.connectionRevocations, ["connection-current", "connection-unchecked"])
})

test("settings filesystem: display actions ignore mutation preconditions without reading snapshots", async () => {
  const fixture = createFixture()
  const ref = settingsSectionFileRef("connections")

  assert.deepEqual(
    await fixture.fs.invoke(ref, "open", undefined, UI_ACTION, { expectedVersion: "stale" }),
    { ref },
  )
  assert.deepEqual(fixture.reads, [])
})

test("settings filesystem: mutation results notify watchers and backend failures are redacted", async () => {
  const fixture = createFixture({
    manageRuntimeExtension() {
      throw new Error("Authorization: Bearer RUNTIME_ACTION_SECRET")
    },
  })
  const connections = settingsSectionFileRef("connections")
  const events: string[] = []
  const handle = fixture.fs.watch?.(connections, UI_WATCH, (event) => events.push(event.ref.fileId))
  assert.ok(handle)

  await fixture.fs.invoke(
    connections,
    SETTINGS_CONNECTION_REVOKE_ACTION,
    { id: "connection-1" },
    UI_ACTION,
  )
  await Promise.resolve()
  assert.deepEqual(events, [connections.fileId])
  handle.dispose()

  await assert.rejects(
    fixture.fs.invoke(
      settingsSectionFileRef("runtime-extensions"),
      SETTINGS_RUNTIME_RETRY_ACTION,
      { id: "extension-1" },
      UI_ACTION,
    ),
    (error) =>
      error instanceof FileSystemError &&
      error.code === "unavailable" &&
      error.message.includes("[redacted]") &&
      !error.message.includes("RUNTIME_ACTION_SECRET"),
  )
})

test("settings filesystem: root watch coalesces source events and tears down all sources", async () => {
  const fixture = createFixture()
  const events: Array<{ ref: { fileId: string }; entryId?: string }> = []
  const handle = fixture.fs.watch?.(settingsRootRef, UI_WATCH, (event) => events.push(event))
  assert.ok(handle)
  assert.deepEqual(
    SETTINGS_SECTION_IDS.map((section) => fixture.subscriptions.get(section)),
    [1, 1, 1, 1, 1],
  )

  fixture.emit("connections")
  fixture.emit("connections")
  await Promise.resolve()
  assert.deepEqual(events, [
    {
      ref: settingsSectionFileRef("connections"),
      entryId: "connections",
      oldParent: settingsRootRef,
      newParent: settingsRootRef,
      type: "changed",
    },
  ])

  handle.dispose()
  assert.deepEqual(
    SETTINGS_SECTION_IDS.map((section) => fixture.subscriptions.get(section)),
    [0, 0, 0, 0, 0],
  )
  fixture.emit("device")
  await Promise.resolve()
  assert.equal(events.length, 1)
})

test("settings filesystem: active Engine may watch its leaf but cannot aggregate root timing", () => {
  const fixture = createFixture()
  assert.throws(
    () =>
      fixture.fs.watch?.(
        settingsRootRef,
        {
          actor: "engine",
          permissions: [],
          activeFile: settingsRootRef,
          intent: "watch",
        },
        () => {},
      ),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )

  const appearance = settingsSectionFileRef("appearance")
  const leaf = fixture.fs.watch?.(
    appearance,
    { actor: "engine", permissions: [], activeFile: appearance, intent: "watch" },
    () => {},
  )
  assert.ok(leaf)
  leaf.dispose()

  const privileged = fixture.fs.watch?.(
    settingsRootRef,
    { actor: "engine", permissions: [SETTINGS_READ_PERMISSION], intent: "watch" },
    () => {},
  )
  assert.ok(privileged)
  privileged.dispose()
})

test("settings filesystem: same-process theme choice emits an appearance watch event", async () => {
  const events: string[] = []
  const appearance = settingsSectionFileRef("appearance")
  const handle = settingsFileSystem.watch?.(appearance, UI_WATCH, (event) =>
    events.push(event.ref.fileId),
  )
  assert.ok(handle)

  setThemeChoice("system")
  await Promise.resolve()
  assert.deepEqual(events, [appearance.fileId])
  handle.dispose()
})

test("settings filesystem: runtime diagnostics are bounded and redact nested secrets", () => {
  const failure: Record<string, unknown> = {
    token: "top-secret-token",
    self: null,
    url: "https://example.test/run?api_key=URLSECRET&safe=visible",
    args: ['--header "Authorization: Bearer ARGSECRET"', "--token", "CLISECRET"],
    nested: { authorization: "Bearer HEADERSECRET", detail: "y".repeat(4_000) },
    message: `Authorization: Bearer MESSAGESECRET ${"x".repeat(2_000)}`,
  }
  failure.self = failure

  const safe = sanitizeSettingsDiagnostic(failure)
  const text = settingsDiagnosticMessage(failure)
  const serialized = JSON.stringify(safe)
  assert.ok(text)
  assert.ok(text.length <= 1024)
  for (const secret of [
    "top-secret-token",
    "URLSECRET",
    "ARGSECRET",
    "CLISECRET",
    "HEADERSECRET",
    "MESSAGESECRET",
  ]) {
    assert.equal(serialized.includes(secret), false, secret)
    assert.equal(text.includes(secret), false, secret)
  }
  assert.ok(serialized.includes("[circular]"))
  assert.ok(serialized.includes("?[redacted]"))
  assert.ok(
    (safe as { nested: { detail: string } }).nested.detail.length <= 1024,
    "each nested diagnostic string must be bounded before serialization",
  )

  const projected = settingsRuntimeExtensionSnapshot({
    id: "extension.example",
    label: "Example",
    version: 1,
    source: {
      kind: "package",
      id: "package.example",
      location: "https://packages.test/item?token=LOCATIONSECRET",
    },
    permissions: ["fs:read"],
    digest: "digest",
    permissionDigest: "permission-digest",
    verification: { verifierId: "host-verifier", verifiedAt: 10 },
    grantedAt: 11,
    consentReceipt: "CONSENTSECRET",
    desired: true,
    health: "degraded",
    failure,
    pendingCleanup: ["https://cleanup.test/item?token=CLEANUPSECRET"],
  })
  const projectionJson = JSON.stringify(projected)
  assert.deepEqual(projected.source, { kind: "package", id: "package.example" })
  assert.equal("consentReceipt" in projected, false)
  for (const secret of ["LOCATIONSECRET", "CONSENTSECRET", "CLEANUPSECRET"]) {
    assert.equal(projectionJson.includes(secret), false, secret)
  }
})

test("settings filesystem: appearance backend failures become structured FileSystem errors", async () => {
  const fixture = createFixture({
    writeAppearance() {
      throw new ReferenceError("window is not defined")
    },
  })
  await assert.rejects(
    fixture.fs.write(settingsSectionFileRef("appearance"), { data: { choice: "dark" } }, UI_WRITE),
    (error) =>
      error instanceof FileSystemError &&
      error.code === "offline" &&
      error.message.includes("window is not defined"),
  )
})
