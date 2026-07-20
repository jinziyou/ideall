import assert from "node:assert/strict"
import { test } from "node:test"
import type { FileRef } from "@protocol/file-system"
import { registerFileSystem } from "@/filesystem/registry"
import { FileSystemError } from "@/filesystem/types"
import {
  SETTINGS_CONNECTION_REVOKE_ACTION,
  createSettingsFileSystem,
  settingsSectionFileRef,
  type SettingsFileSystemDeps,
  type SettingsSectionId,
  type SettingsThemeChoice,
} from "./settings-file-system"
import {
  revokeSettingsConnection,
  setSettingsThemeChoice,
  type SettingsMutationClient,
  withSettingsSectionMutationLock,
} from "./settings-write-adapter"

const UI_CONTENT = { actor: "ui", permissions: [], intent: "content" } as const
const UI_WRITE = { actor: "ui", permissions: [], intent: "write" } as const
const UI_ACTION = { actor: "ui", permissions: [], intent: "action" } as const

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function fixture(overrides: Partial<SettingsFileSystemDeps> = {}) {
  let appearanceChoice: SettingsThemeChoice = "light"
  const connectionIds = new Set(["connection-1"])
  const values: Record<SettingsSectionId, unknown> = {
    appearance: { choice: appearanceChoice, effectiveColorScheme: appearanceChoice },
    device: {
      sync: { enabled: false, lastRun: null },
      storage: null,
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
          nodes: 0,
          blobs: 0,
          trashSnapshots: 0,
          agentTasks: 0,
          agentWriteAudits: 0,
        },
        error: null,
      },
      storage: { persistenceAvailable: true, persisted: true },
    },
    connections: [{ id: "connection-1" }],
    "runtime-extensions": [],
  }
  const deps: SettingsFileSystemDeps = {
    read(section) {
      if (section === "appearance") {
        return { choice: appearanceChoice, effectiveColorScheme: appearanceChoice }
      }
      if (section === "connections") {
        return [...connectionIds].map((id) => ({ id }))
      }
      return values[section]
    },
    writeAppearance(choice) {
      appearanceChoice = choice
    },
    exportWorkspaceArchive() {
      return { filename: "workspace.json", content: "{}", encrypted: false }
    },
    previewWorkspaceArchive(_content, filename) {
      return {
        ok: false,
        encrypted: false,
        requiresPassphrase: false,
        filename: filename ?? null,
        error: "invalid",
        package: null,
        archive: null,
      }
    },
    importWorkspaceArchive() {
      return {
        changed: true,
        reloadRequired: true,
        imported: { nodes: 0, blobs: 0, trash: 0, plugins: 0 },
      }
    },
    requestPersistentStorage() {
      return { available: true, granted: true }
    },
    selfTestSecureStore() {
      return { backend: "system-keychain", roundTrip: true, cleanedUp: true }
    },
    revokeConnection(id) {
      return connectionIds.delete(id)
    },
    manageRuntimeExtension() {
      return false
    },
    subscribe() {
      return () => undefined
    },
    ...overrides,
  }
  return {
    provider: createSettingsFileSystem(deps),
    connectionIds,
    get appearanceChoice() {
      return appearanceChoice
    },
    setAppearanceChoice(choice: SettingsThemeChoice) {
      appearanceChoice = choice
    },
  }
}

function providerMutationClient(state: ReturnType<typeof fixture>): SettingsMutationClient {
  return {
    write(ref, input) {
      return state.provider.write(ref, input, UI_WRITE)
    },
    invoke(ref, action, input) {
      return state.provider.invoke(ref, action, input, UI_ACTION)
    },
  }
}

test("settings write adapter: resolves every mutation to the canonical section FileRef", async () => {
  const refs: FileRef[] = []
  const tracingLock = async <T>(ref: FileRef, operation: () => T | Promise<T>): Promise<T> => {
    refs.push(ref)
    return operation()
  }

  await withSettingsSectionMutationLock("appearance", () => undefined, tracingLock)
  await withSettingsSectionMutationLock("connections", () => undefined, tracingLock)

  assert.deepEqual(refs, [
    settingsSectionFileRef("appearance"),
    settingsSectionFileRef("connections"),
  ])
})

test("settings write adapter: routes shell mutations through a narrow FileSystem client", async () => {
  const calls: unknown[] = []
  const client: SettingsMutationClient = {
    async write(ref, input) {
      calls.push({ kind: "write", ref, input })
      return undefined
    },
    async invoke(ref, action, input) {
      calls.push({ kind: "invoke", ref, action, input })
      return { changed: false }
    },
  }

  await setSettingsThemeChoice("dark", client)
  assert.equal(await revokeSettingsConnection("connection-1", client), false)
  assert.deepEqual(calls, [
    {
      kind: "write",
      ref: settingsSectionFileRef("appearance"),
      input: {
        data: { choice: "dark" },
        mediaType: "application/json",
      },
    },
    {
      kind: "invoke",
      ref: settingsSectionFileRef("connections"),
      action: SETTINGS_CONNECTION_REVOKE_ACTION,
      input: { id: "connection-1" },
    },
  ])
})

test("settings write adapter: default client enters the registered Settings provider", async () => {
  const state = fixture()
  const dispose = registerFileSystem(state.provider)
  try {
    await setSettingsThemeChoice("dark")
    assert.equal(state.appearanceChoice, "dark")
    assert.equal(await revokeSettingsConnection("connection-1"), true)
    assert.equal(await revokeSettingsConnection("connection-1"), false)
    assert.deepEqual([...state.connectionIds], [])
  } finally {
    dispose()
  }
})

test("settings write adapter: external appearance writes serialize before provider CAS", async () => {
  const externalEntered = deferred()
  const releaseExternal = deferred()
  const events: string[] = []
  let state!: ReturnType<typeof fixture>
  state = fixture({
    async writeAppearance(choice) {
      events.push("external:start")
      state.setAppearanceChoice(choice)
      externalEntered.resolve()
      await releaseExternal.promise
      events.push("external:end")
    },
  })
  const client = providerMutationClient(state)
  const appearance = settingsSectionFileRef("appearance")
  const before = await state.provider.read(appearance, UI_CONTENT)

  const externalWrite = setSettingsThemeChoice("dark", client)
  await externalEntered.promise

  const providerWrite = state.provider.write(
    appearance,
    { data: { choice: "system" }, expectedVersion: before.version },
    UI_WRITE,
  )
  await tick()
  assert.deepEqual(events, ["external:start"], "provider must wait for the external writer")

  releaseExternal.resolve()
  await externalWrite
  await assert.rejects(
    providerWrite,
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.deepEqual(events, ["external:start", "external:end"])
  assert.equal(state.appearanceChoice, "dark")
})

test("settings write adapter: external connection revoke waits for provider mutation and is idempotent", async () => {
  const providerEntered = deferred()
  const releaseProvider = deferred()
  const events: string[] = []
  let state!: ReturnType<typeof fixture>
  state = fixture({
    async revokeConnection(id) {
      if (!state.connectionIds.has(id)) return false
      events.push("provider:start")
      providerEntered.resolve()
      await releaseProvider.promise
      events.push("provider:end")
      return state.connectionIds.delete(id)
    },
  })
  const client = providerMutationClient(state)
  const connections = settingsSectionFileRef("connections")

  const providerRevoke = state.provider.invoke(
    connections,
    SETTINGS_CONNECTION_REVOKE_ACTION,
    { id: "connection-1" },
    UI_ACTION,
  )
  await providerEntered.promise

  let externalSettled = false
  const externalRevoke = revokeSettingsConnection("connection-1", client).finally(() => {
    externalSettled = true
  })
  await tick()
  assert.deepEqual(events, ["provider:start"], "external revoke must wait for the provider")
  assert.equal(externalSettled, false)

  releaseProvider.resolve()
  const [providerResult, externalResult] = await Promise.all([providerRevoke, externalRevoke])
  assert.deepEqual(providerResult, { changed: true })
  assert.equal(externalResult, false)
  assert.deepEqual(events, ["provider:start", "provider:end"])
})

test("settings write adapter: failures release the lock and repeated connection revokes are no-ops", async () => {
  let appearanceWrites = 0
  let revocations = 0
  let state!: ReturnType<typeof fixture>
  state = fixture({
    writeAppearance(choice) {
      appearanceWrites += 1
      if (appearanceWrites === 1) throw new Error("appearance backend failed")
      state.setAppearanceChoice(choice)
    },
    revokeConnection(id) {
      if (!state.connectionIds.has(id)) return false
      revocations += 1
      if (revocations === 1) throw new Error("capability revoke failed")
      return state.connectionIds.delete(id)
    },
  })
  const client = providerMutationClient(state)

  await assert.rejects(
    setSettingsThemeChoice("dark", client),
    (error) => error instanceof FileSystemError && error.code === "offline",
  )
  await setSettingsThemeChoice("light", client)
  assert.equal(appearanceWrites, 2, "a failed writer must release the appearance lock")
  assert.equal(state.appearanceChoice, "light")

  await assert.rejects(
    revokeSettingsConnection("connection-1", client),
    (error) => error instanceof FileSystemError && error.code === "unavailable",
  )
  assert.equal(state.connectionIds.has("connection-1"), true)
  assert.equal(await revokeSettingsConnection("connection-1", client), true)
  assert.equal(await revokeSettingsConnection("connection-1", client), false)
  assert.equal(revocations, 2, "an already revoked connection must not reach the backend")
})
