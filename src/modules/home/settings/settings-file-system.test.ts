import assert from "node:assert/strict"
import { test } from "node:test"
import { FileSystemError } from "@/filesystem/types"
import { setThemeChoice } from "@/lib/theme"
import {
  SETTINGS_CONNECTION_REVOKE_ACTION,
  SETTINGS_READ_PERMISSION,
  SETTINGS_ROOT_MEDIA_TYPE,
  SETTINGS_RUNTIME_RETRY_ACTION,
  SETTINGS_RUNTIME_REVOKE_ACTION,
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
  } = {},
) {
  const state: Record<SettingsSectionId, unknown> = {
    appearance: { choice: "light", effectiveColorScheme: "light" },
    device: {
      sync: { enabled: true },
      storage: { usage: 10, quota: 100 },
      publishingIdentity: { signedIn: false, user: null },
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
    revokeConnection(id) {
      connectionRevocations.push(id)
      return options.revokeConnection?.(id) ?? true
    },
    manageRuntimeExtension(action, id) {
      runtimeActions.push({ action, id })
      return options.manageRuntimeExtension?.(action, id) ?? true
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

test("settings filesystem: semantic root projects four stable snapshot files without reading them", async () => {
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
    limit: 2,
  })
  const entries = [...first.entries, ...second.entries]
  assert.deepEqual(
    entries.map((entry) => entry.entryId),
    SETTINGS_SECTION_IDS,
  )
  assert.deepEqual(
    entries.map((entry) => entry.pathName),
    ["appearance.json", "device.json", "connections.json", "runtime-extensions.json"],
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
        id: SETTINGS_RUNTIME_UNINSTALL_ACTION,
        kind: "specialized",
        requires: [SETTINGS_WRITE_PERMISSION],
      },
    ],
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
    [1, 1, 1, 1],
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
    [0, 0, 0, 0],
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
