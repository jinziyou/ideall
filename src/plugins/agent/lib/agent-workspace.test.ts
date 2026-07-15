import assert from "node:assert/strict"
import { test } from "node:test"
import {
  AGENT_WORKSPACES_STORAGE_KEY,
  createAgentWorkspaceStore,
  type AgentWorkspace,
  type AgentWorkspaceStoreDeps,
  type WorkspacesState,
} from "./agent-workspace"

const MAX_WORKSPACE_REVISION = "9".repeat(64)
const BEFORE_MAX_WORKSPACE_REVISION = (BigInt(MAX_WORKSPACE_REVISION) - 1n).toString()

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()
  failNextSet: Error | null = null

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    if (this.failNextSet) {
      const error = this.failNextSet
      this.failNextSet = null
      throw error
    }
    this.values.set(key, value)
  }

  seed(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function deferred<T = void>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function workspace(id = "ws-1", patch: Partial<AgentWorkspace> = {}): AgentWorkspace {
  return {
    id,
    name: `Workspace ${id}`,
    data: {
      includeHome: true,
      home: {
        notes: true,
        subscriptions: true,
        bookmarks: true,
        folders: true,
        files: true,
      },
      dirNodeId: null,
      osDir: null,
    },
    capabilities: {
      permissions: ["fs:read"],
      toolAllowlist: null,
      skillIds: null,
      appIds: null,
    },
    rules: { ruleIds: [] },
    prompt: { instructions: "", template: "", precise: false, override: "" },
    model: { useGlobal: true, baseURL: "", model: "", apiKey: "" },
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function envelope(state: WorkspacesState, revision: number | string): string {
  return JSON.stringify({
    ...state,
    workspaces: state.workspaces.map((item) => ({
      ...item,
      model: { ...item.model, apiKey: "" },
    })),
    _revision: String(revision),
  })
}

function credential(target: string | null, apiKey = "", revision: number | string = 1): string {
  return JSON.stringify({ version: 2, target, apiKey, revision: String(revision) })
}

function legacyCredential(target: string | null, apiKey = ""): string {
  return JSON.stringify({ version: 1, target, apiKey })
}

function decodedCredential(raw: string | undefined): {
  version: number
  target: string | null
  apiKey: string
  revision?: string
} | null {
  return raw
    ? (JSON.parse(raw) as {
        version: number
        target: string | null
        apiKey: string
        revision?: string
      })
    : null
}

type InvalidationSource = "local" | "broadcast"

function createInvalidationHub() {
  const endpoints = new Map<number, Set<(source: InvalidationSource) => void>>()
  let nextId = 0
  return {
    endpoint(): AgentWorkspaceStoreDeps["invalidation"] {
      const id = ++nextId
      const listeners = new Set<(source: InvalidationSource) => void>()
      endpoints.set(id, listeners)
      return {
        publish() {
          for (const [endpointId, endpointListeners] of endpoints) {
            for (const listener of [...endpointListeners]) {
              listener(endpointId === id ? "local" : "broadcast")
            }
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    },
  }
}

function createLifecycle() {
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    resume(): void {
      for (const listener of [...listeners]) listener()
    },
  }
}

function createDeps(
  storage: MemoryStorage,
  options: Partial<AgentWorkspaceStoreDeps> = {},
): AgentWorkspaceStoreDeps {
  const secure = new Map<string, string>()
  let timestamp = 100
  let id = 0
  return {
    storage: () => storage,
    secureGet: async (key) => secure.get(key) ?? null,
    secureSet: async (key, value) => void secure.set(key, value),
    secureDelete: async (key) => void secure.delete(key),
    secureFallbackGet: (key) => secure.get(key) ?? null,
    isTauri: () => false,
    now: () => ++timestamp,
    genId: (prefix) => `${prefix}-generated-${++id}`,
    invalidation: createInvalidationHub().endpoint(),
    withRefreshLock: async (operation) => operation(),
    subscribeLifecycle: () => () => {},
    ...options,
  }
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

test("agent workspace store: legacy snapshot migrates secure key before atomic revision envelope", async () => {
  const storage = new MemoryStorage()
  const secure = new Map<string, string>()
  const secureSetEntered = deferred()
  const releaseSecureSet = deferred()
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    JSON.stringify({
      activeId: "explicit",
      workspaces: [
        {
          id: "explicit",
          name: "Explicit",
          capabilities: {
            permissions: [
              "fs:read",
              "agent.config:read",
              "identity.publish",
              "future.unknown",
              "fs:read",
            ],
          },
          model: {
            useGlobal: false,
            baseURL: "https://api.example.test/v1",
            model: "m",
            apiKey: "legacy-secret",
          },
        },
        { id: "defaulted", name: "Defaulted" },
      ],
    }),
  )
  const store = createAgentWorkspaceStore(
    createDeps(storage, {
      secureGet: async (key) => secure.get(key) ?? null,
      secureSet: async (key, value) => {
        secureSetEntered.resolve()
        await releaseSecureSet.promise
        secure.set(key, value)
      },
      secureDelete: async (key) => void secure.delete(key),
      secureFallbackGet: (key) => secure.get(key) ?? null,
    }),
  )

  assert.equal(store.revisionSnapshot(), "0")
  assert.deepEqual(store.getState().workspaces[0]?.capabilities.permissions, [
    "fs:read",
    "agent.config:read",
  ])
  assert.equal(
    store.getState().workspaces[1]?.capabilities.permissions.includes("agent.config:read"),
    false,
  )

  const refresh = store.refreshRaw()
  await secureSetEntered.promise
  assert.equal(
    (JSON.parse(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!) as { _revision?: string })
      ._revision,
    undefined,
    "legacy public data must not advance before secure migration commits",
  )

  releaseSecureSet.resolve()
  await refresh
  const persisted = JSON.parse(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!) as {
    _revision: string
    workspaces: AgentWorkspace[]
  }
  assert.equal(persisted._revision, "1")
  assert.equal(persisted.workspaces[0]?.model.apiKey, "")
  assert.deepEqual(decodedCredential(secure.get("ideall:agent:workspace:explicit:apiKey")), {
    version: 2,
    target: "https://api.example.test/v1",
    apiKey: "legacy-secret",
    revision: "1",
  })
  assert.equal(store.revisionSnapshot(), "1")
  assert.equal("_revision" in store.getState(), false)
  assert.equal("_revision" in store.securitySnapshot(), false)
})

test("agent workspace store: no-op preserves revision and same-revision different token is rejected", async () => {
  const storage = new MemoryStorage()
  const initial = workspace("ws-1")
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [initial], activeId: initial.id }, 5),
  )
  const store = createAgentWorkspaceStore(createDeps(storage))
  await store.refreshRaw()

  await store.setActiveRaw(initial.id)
  await store.updateRaw(initial.id, (current) => current)
  assert.equal(store.revisionSnapshot(), "5")

  const conflicting = workspace("ws-1", { name: "same revision conflict" })
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [conflicting], activeId: conflicting.id }, 5),
  )
  await store.refreshRaw()
  assert.equal(store.get("ws-1")?.name, initial.name)
  assert.equal(store.revisionSnapshot(), "5")

  await store.renameRaw("ws-1", "Accepted")
  assert.equal(store.revisionSnapshot(), "6")
  assert.equal(store.get("ws-1")?.name, "Accepted")
  assert.equal(
    (JSON.parse(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!) as { _revision: string })._revision,
    "6",
  )

  let notifications = 0
  const unsubscribe = store.subscribe(() => {
    notifications += 1
  })
  await flushPromises()
  storage.seed(AGENT_WORKSPACES_STORAGE_KEY, envelope(store.getState(), 7))
  await store.refreshRaw()
  assert.equal(store.revisionSnapshot(), "7")
  assert.equal(notifications, 1, "revision-only advancement must invalidate FileSystem watches")
  unsubscribe()
})

test("agent workspace store: secure mutation gates commit and a failure does not poison the queue", async () => {
  const storage = new MemoryStorage()
  const secure = new Map<string, string>()
  const key = "ideall:agent:workspace:ws-1:apiKey"
  secure.set(key, credential("https://api.example.test/v1", "old-key"))
  const initial = workspace("ws-1", {
    model: {
      useGlobal: false,
      baseURL: "https://api.example.test/v1",
      model: "m",
      apiKey: "",
    },
  })
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [initial], activeId: initial.id }, 2),
  )
  let gateNextSet = false
  let failNextSet = false
  const secureSetEntered = deferred()
  const releaseSecureSet = deferred()
  const store = createAgentWorkspaceStore(
    createDeps(storage, {
      secureGet: async (secureKey) => secure.get(secureKey) ?? null,
      secureSet: async (secureKey, value) => {
        if (failNextSet) {
          failNextSet = false
          throw new Error("secure unavailable")
        }
        if (gateNextSet) {
          gateNextSet = false
          secureSetEntered.resolve()
          await releaseSecureSet.promise
        }
        secure.set(secureKey, value)
      },
      secureDelete: async (secureKey) => void secure.delete(secureKey),
      secureFallbackGet: (secureKey) => secure.get(secureKey) ?? null,
    }),
  )
  await store.refreshRaw()
  let notifications = 0
  const unsubscribe = store.subscribe(() => {
    notifications += 1
  })
  await flushPromises()

  gateNextSet = true
  const pending = store.saveRaw({
    ...store.get("ws-1")!,
    model: { ...store.get("ws-1")!.model, apiKey: "new-key" },
  })
  await secureSetEntered.promise
  assert.equal(store.revisionSnapshot(), "2")
  assert.equal(store.get("ws-1")?.model.apiKey, "old-key")
  assert.equal(notifications, 0)
  releaseSecureSet.resolve()
  await pending
  assert.equal(store.revisionSnapshot(), "3")
  assert.equal(store.get("ws-1")?.model.apiKey, "new-key")
  assert.equal(notifications, 1)

  failNextSet = true
  await assert.rejects(
    store.saveRaw({
      ...store.get("ws-1")!,
      model: { ...store.get("ws-1")!.model, apiKey: "rejected-key" },
    }),
    /secure unavailable/,
  )
  assert.equal(store.revisionSnapshot(), "3")
  assert.equal(store.get("ws-1")?.model.apiKey, "new-key")
  assert.equal(decodedCredential(secure.get(key))?.apiKey, "new-key")
  assert.equal(notifications, 1)

  failNextSet = true
  await assert.rejects(
    store.updateRaw("ws-1", (current) => ({
      ...current,
      model: { ...current.model, baseURL: "https://rejected.example.test/v1" },
    })),
    /secure unavailable/,
  )
  assert.equal(store.revisionSnapshot(), "3")
  assert.equal(store.get("ws-1")?.model.baseURL, "https://api.example.test/v1")
  assert.equal(store.get("ws-1")?.model.apiKey, "new-key")
  assert.equal(decodedCredential(secure.get(key))?.apiKey, "new-key")
  assert.equal(notifications, 1)

  await store.renameRaw("ws-1", "Queue recovered")
  assert.equal(store.revisionSnapshot(), "4")
  assert.equal(store.get("ws-1")?.name, "Queue recovered")
  unsubscribe()
})

test("agent workspace store: localStorage failure rolls secure mutation back without publishing", async () => {
  const storage = new MemoryStorage()
  const secure = new Map<string, string>()
  const key = "ideall:agent:workspace:ws-1:apiKey"
  secure.set(key, credential("https://api.example.test/v1", "old-key"))
  const initial = workspace("ws-1", {
    model: {
      useGlobal: false,
      baseURL: "https://api.example.test/v1",
      model: "m",
      apiKey: "",
    },
  })
  const originalRaw = envelope({ workspaces: [initial], activeId: initial.id }, 9)
  storage.seed(AGENT_WORKSPACES_STORAGE_KEY, originalRaw)
  const secureWrites: string[] = []
  const store = createAgentWorkspaceStore(
    createDeps(storage, {
      secureGet: async (secureKey) => secure.get(secureKey) ?? null,
      secureSet: async (secureKey, value) => {
        secureWrites.push(value)
        secure.set(secureKey, value)
      },
      secureDelete: async (secureKey) => void secure.delete(secureKey),
      secureFallbackGet: (secureKey) => secure.get(secureKey) ?? null,
    }),
  )
  await store.refreshRaw()
  let notifications = 0
  const unsubscribe = store.subscribe(() => {
    notifications += 1
  })
  await flushPromises()
  storage.failNextSet = new Error("quota exceeded")

  await assert.rejects(
    store.saveRaw({
      ...store.get("ws-1")!,
      model: { ...store.get("ws-1")!.model, apiKey: "new-key" },
    }),
    /quota exceeded/,
  )
  assert.deepEqual(
    secureWrites.slice(-2).map((raw) => decodedCredential(raw)?.apiKey),
    ["new-key", "old-key"],
  )
  assert.equal(decodedCredential(secure.get(key))?.apiKey, "old-key")
  assert.equal(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY), originalRaw)
  assert.equal(store.revisionSnapshot(), "9")
  assert.equal(store.get("ws-1")?.model.apiKey, "old-key")
  assert.equal(notifications, 0)
  unsubscribe()
})

test("agent workspace store: broadcast during secure await forces a tail read across stores", async () => {
  const storage = new MemoryStorage()
  const hub = createInvalidationHub()
  const lifecycle = createLifecycle()
  const initial = workspace("ws-1")
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [initial], activeId: initial.id }, 1),
  )
  const storeA = createAgentWorkspaceStore(createDeps(storage, { invalidation: hub.endpoint() }))
  let gateNextRead = false
  const secureReadEntered = deferred()
  const releaseSecureRead = deferred()
  const storeB = createAgentWorkspaceStore(
    createDeps(storage, {
      invalidation: hub.endpoint(),
      secureGet: async () => {
        if (gateNextRead) {
          gateNextRead = false
          secureReadEntered.resolve()
          await releaseSecureRead.promise
        }
        return null
      },
      subscribeLifecycle: lifecycle.subscribe,
    }),
  )
  await storeA.refreshRaw()
  await storeB.refreshRaw()
  const unsubscribe = storeB.subscribe(() => {})
  await flushPromises()

  gateNextRead = true
  const staleRefresh = storeB.refreshRaw()
  await secureReadEntered.promise
  await storeA.renameRaw("ws-1", "From window A")
  releaseSecureRead.resolve()
  await staleRefresh
  await flushPromises()

  assert.equal(storeB.revisionSnapshot(), "2")
  assert.equal(storeB.get("ws-1")?.name, "From window A")

  const lifecycleValue = workspace("ws-1", { name: "Recovered on pageshow" })
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [lifecycleValue], activeId: lifecycleValue.id }, 3),
  )
  lifecycle.resume()
  await flushPromises()
  await flushPromises()
  assert.equal(storeB.revisionSnapshot(), "3")
  assert.equal(storeB.get("ws-1")?.name, "Recovered on pageshow")
  unsubscribe()
})

test("agent workspace store: queued stale updaters merge against fresh state without secure rewrites", async () => {
  const storage = new MemoryStorage()
  const secure = new Map<string, string>()
  const key = "ideall:agent:workspace:ws-1:apiKey"
  secure.set(key, credential("https://api.example.test/v1", "workspace-key"))
  const initial = workspace("ws-1", {
    model: {
      useGlobal: false,
      baseURL: "https://api.example.test/v1",
      model: "m",
      apiKey: "",
    },
  })
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [initial], activeId: initial.id }, 1),
  )
  let secureSets = 0
  let secureDeletes = 0
  const store = createAgentWorkspaceStore(
    createDeps(storage, {
      secureGet: async (secureKey) => secure.get(secureKey) ?? null,
      secureSet: async (secureKey, value) => {
        secureSets += 1
        secure.set(secureKey, value)
      },
      secureDelete: async (secureKey) => {
        secureDeletes += 1
        secure.delete(secureKey)
      },
      secureFallbackGet: (secureKey) => secure.get(secureKey) ?? null,
    }),
  )
  await store.refreshRaw()

  const first = store.updateRaw("ws-1", (current) => ({
    ...current,
    data: { ...current.data, includeHome: false },
  }))
  const second = store.updateRaw("ws-1", (current) => ({
    ...current,
    prompt: { ...current.prompt, instructions: "fresh updater" },
  }))
  await Promise.all([first, second])

  assert.equal(store.get("ws-1")?.data.includeHome, false)
  assert.equal(store.get("ws-1")?.prompt.instructions, "fresh updater")
  assert.equal(store.get("ws-1")?.model.apiKey, "workspace-key")
  assert.equal(store.revisionSnapshot(), "3")
  assert.equal(secureSets, 0)
  assert.equal(secureDeletes, 0)

  await store.updateRaw("ws-1", (current) => ({
    ...current,
    model: { ...current.model, baseURL: "https://other.example.test/v1" },
  }))
  assert.equal(store.get("ws-1")?.model.apiKey, "")
  assert.equal(secureDeletes, 0, "workspace credentials use tombstones instead of unsafe deletes")
  assert.deepEqual(decodedCredential(secure.get(key)), {
    version: 2,
    target: null,
    apiKey: "",
    revision: "4",
  })

  await store.updateRaw("ws-1", (current) => ({
    ...current,
    model: {
      ...current.model,
      baseURL: "https://third.example.test/v1",
      apiKey: "explicit-new-key",
    },
  }))
  assert.equal(store.get("ws-1")?.model.apiKey, "explicit-new-key")
  assert.equal(secureSets, 2, "endpoint tombstone and explicitly bound key are both durable writes")
  assert.deepEqual(decodedCredential(secure.get(key)), {
    version: 2,
    target: "https://third.example.test/v1",
    apiKey: "explicit-new-key",
    revision: "5",
  })
})

test("agent workspace store: credential records never cross canonical endpoint targets", async () => {
  const storage = new MemoryStorage()
  const native = new Map<string, string>()
  const fallback = new Map<string, string>()
  const key = "ideall:agent:workspace:ws-1:apiKey"
  const endpointA = "https://a.example.test/v1"
  const endpointB = "https://b.example.test/v1"
  const initial = workspace("ws-1", {
    model: { useGlobal: false, baseURL: endpointA, model: "m", apiKey: "" },
  })
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [initial], activeId: initial.id }, 1),
  )
  native.set(key, credential(endpointA, "secret-for-a"))
  const deps = createDeps(storage, {
    secureGet: async (secureKey) => native.get(secureKey) ?? fallback.get(secureKey) ?? null,
    secureSet: async (secureKey, value) => {
      native.set(secureKey, value)
      fallback.delete(secureKey)
    },
    secureFallbackGet: (secureKey) => fallback.get(secureKey) ?? null,
  })
  const store = createAgentWorkspaceStore(deps)
  await store.refreshRaw()
  assert.equal(store.resolveModel(store.get("ws-1")!).apiKey, "secret-for-a")
  const staleClone = structuredClone(store.get("ws-1")!)
  staleClone.model.baseURL = endpointB
  staleClone.model.apiKey = ""
  assert.equal(
    store.resolveModel(staleClone).apiKey,
    "",
    "id cache must not rebind endpoint A credentials to an endpoint B draft",
  )

  const redirected = workspace("ws-1", {
    model: { useGlobal: false, baseURL: endpointB, model: "m", apiKey: "" },
  })
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [redirected], activeId: redirected.id }, 2),
  )
  await store.refreshRaw()

  assert.equal(store.get("ws-1")?.model.baseURL, endpointB)
  assert.equal(store.resolveModel(store.get("ws-1")!).apiKey, "")
  assert.deepEqual(decodedCredential(native.get(key)), {
    version: 2,
    target: null,
    apiKey: "",
    revision: "3",
  })
  assert.equal(store.revisionSnapshot(), "3", "mismatch cleanup must advance the hidden revision")

  // A newer fallback tombstone represents a failed native write and must shadow native stale data.
  native.set(key, credential(endpointB, "stale-native-key"))
  fallback.set(key, credential(null))
  const reloaded = createAgentWorkspaceStore(deps)
  await reloaded.refreshRaw()
  assert.equal(reloaded.resolveModel(reloaded.get("ws-1")!).apiKey, "")
  assert.deepEqual(decodedCredential(native.get(key)), {
    version: 2,
    target: null,
    apiKey: "",
    revision: "1",
  })
})

test("agent workspace store: committed older credential remains valid after public-only revisions", async () => {
  const storage = new MemoryStorage()
  const secure = new Map<string, string>()
  const endpoint = "https://api.example.test/v1"
  const key = "ideall:agent:workspace:ws-1:apiKey"
  const initial = workspace("ws-1", {
    model: { useGlobal: false, baseURL: endpoint, model: "m", apiKey: "" },
  })
  const original = envelope({ workspaces: [initial], activeId: initial.id }, 5)
  storage.seed(AGENT_WORKSPACES_STORAGE_KEY, original)
  secure.set(key, credential(endpoint, "stable-key", 1))
  const store = createAgentWorkspaceStore(
    createDeps(storage, {
      secureGet: async (secureKey) => secure.get(secureKey) ?? null,
      secureSet: async (secureKey, value) => void secure.set(secureKey, value),
      secureFallbackGet: (secureKey) => secure.get(secureKey) ?? null,
    }),
  )

  assert.equal(store.resolveModel(store.get("ws-1")!).apiKey, "stable-key")
  await store.refreshRaw()
  assert.equal(store.resolveModel(store.get("ws-1")!).apiKey, "stable-key")
  assert.equal(store.revisionSnapshot(), "5")
  assert.equal(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY), original)
})

test("agent workspace store: revisioned plaintext and bare secure values migrate atomically", async () => {
  const endpoint = "https://api.example.test/v1"
  const key = "ideall:agent:workspace:ws-1:apiKey"

  const plaintextStorage = new MemoryStorage()
  const plaintextSecure = new Map<string, string>()
  const plaintextWorkspace = workspace("ws-1", {
    model: { useGlobal: false, baseURL: endpoint, model: "m", apiKey: "plaintext-secret" },
  })
  plaintextStorage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    JSON.stringify({ workspaces: [plaintextWorkspace], activeId: "ws-1", _revision: "7" }),
  )
  const plaintextStore = createAgentWorkspaceStore(
    createDeps(plaintextStorage, {
      secureGet: async (secureKey) => plaintextSecure.get(secureKey) ?? null,
      secureSet: async (secureKey, value) => void plaintextSecure.set(secureKey, value),
      secureFallbackGet: (secureKey) => plaintextSecure.get(secureKey) ?? null,
    }),
  )
  await plaintextStore.refreshRaw()
  const scrubbed = JSON.parse(plaintextStorage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!) as {
    _revision: string
    workspaces: AgentWorkspace[]
  }
  assert.equal(scrubbed._revision, "8")
  assert.equal(scrubbed.workspaces[0]?.model.apiKey, "")
  assert.deepEqual(decodedCredential(plaintextSecure.get(key)), {
    version: 2,
    target: endpoint,
    apiKey: "plaintext-secret",
    revision: "8",
  })

  const bareStorage = new MemoryStorage()
  const bareSecure = new Map<string, string>([[key, "bare-secret"]])
  const bareWorkspace = workspace("ws-1", {
    model: { useGlobal: false, baseURL: endpoint, model: "m", apiKey: "" },
  })
  bareStorage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [bareWorkspace], activeId: "ws-1" }, 4),
  )
  const bareStore = createAgentWorkspaceStore(
    createDeps(bareStorage, {
      secureGet: async (secureKey) => bareSecure.get(secureKey) ?? null,
      secureSet: async (secureKey, value) => void bareSecure.set(secureKey, value),
      secureFallbackGet: () => null,
    }),
  )
  await bareStore.refreshRaw()
  assert.equal(bareStore.revisionSnapshot(), "5")
  assert.deepEqual(decodedCredential(bareSecure.get(key)), {
    version: 2,
    target: endpoint,
    apiKey: "bare-secret",
    revision: "5",
  })

  const v1Storage = new MemoryStorage()
  const v1Secure = new Map<string, string>([[key, legacyCredential(endpoint, "v1-secret")]])
  v1Storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [bareWorkspace], activeId: "ws-1" }, 6),
  )
  const v1Store = createAgentWorkspaceStore(
    createDeps(v1Storage, {
      secureGet: async (secureKey) => v1Secure.get(secureKey) ?? null,
      secureSet: async (secureKey, value) => void v1Secure.set(secureKey, value),
      secureFallbackGet: () => null,
    }),
  )
  await v1Store.refreshRaw()
  assert.equal(v1Store.revisionSnapshot(), "7")
  assert.equal(v1Store.resolveModel(v1Store.get("ws-1")!).apiKey, "v1-secret")
  assert.deepEqual(decodedCredential(v1Secure.get(key)), {
    version: 2,
    target: endpoint,
    apiKey: "v1-secret",
    revision: "7",
  })
})

test("agent workspace store: public envelope canonicalizes model URLs and rejects invalid targets", async () => {
  const storage = new MemoryStorage()
  const secure = new Map<string, string>()
  const initial = workspace("ws-1")
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [initial], activeId: initial.id }, 1),
  )
  const store = createAgentWorkspaceStore(
    createDeps(storage, {
      secureGet: async (key) => secure.get(key) ?? null,
      secureSet: async (key, value) => void secure.set(key, value),
      secureFallbackGet: (key) => secure.get(key) ?? null,
    }),
  )
  await store.refreshRaw()

  await store.updateRaw("ws-1", (current) => ({
    ...current,
    model: {
      useGlobal: false,
      baseURL: "https://user:PASS@api.example.test/v1?key=QUERYSECRET#FRAGMENTSECRET",
      model: "m",
      apiKey: "bound-key",
    },
  }))
  const raw = storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!
  assert.equal(raw.includes("PASS"), false)
  assert.equal(raw.includes("QUERYSECRET"), false)
  assert.equal(raw.includes("FRAGMENTSECRET"), false)
  assert.equal(store.get("ws-1")?.model.baseURL, "https://api.example.test/v1")

  await store.updateRaw("ws-1", (current) => ({
    ...current,
    model: { ...current.model, baseURL: "file:///tmp/model", apiKey: "must-not-bind" },
  }))
  assert.equal(store.get("ws-1")?.model.baseURL, "")
  assert.equal(store.resolveModel(store.get("ws-1")!).apiKey, "")
  assert.deepEqual(decodedCredential(secure.get("ideall:agent:workspace:ws-1:apiKey")), {
    version: 2,
    target: null,
    apiKey: "",
    revision: "3",
  })
})

test("agent workspace store: force repair rewrites a same-body malformed revision token", async () => {
  const storage = new MemoryStorage()
  const initial = workspace("ws-1")
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [initial], activeId: initial.id }, 4),
  )
  let published = 0
  const store = createAgentWorkspaceStore(
    createDeps(storage, {
      invalidation: {
        publish() {
          published += 1
        },
        subscribe: () => () => {},
      },
    }),
  )
  await store.refreshRaw()
  let notifications = 0
  const unsubscribe = store.subscribe(() => {
    notifications += 1
  })
  await flushPromises()
  notifications = 0

  const sameBody = JSON.parse(envelope(store.getState(), 4)) as Record<string, unknown>
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    JSON.stringify({ ...sameBody, _revision: "malformed" }),
  )
  await store.repairPublicRaw(store.getState())

  const repaired = JSON.parse(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!) as {
    _revision: string
    workspaces: AgentWorkspace[]
  }
  assert.equal(repaired._revision, "5")
  assert.equal(repaired.workspaces[0]?.id, "ws-1")
  assert.equal(store.revisionSnapshot(), "5")
  assert.equal(notifications, 1)
  assert.equal(published, 1)
  unsubscribe()
})

test("agent workspace store: malformed cold envelope preserves its revision floor for repair and peers", async () => {
  const storage = new MemoryStorage()
  const secure = new Map<string, string>()
  const hub = createInvalidationHub()
  const endpoint = "https://api.example.test/v1"
  const repairedWorkspace = workspace("ws-1", {
    model: { useGlobal: false, baseURL: endpoint, model: "m", apiKey: "bound-key" },
  })
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    JSON.stringify({ workspaces: "corrupt", activeId: "ws-1", _revision: "100" }),
  )
  const sharedDeps = {
    secureGet: async (key: string) => secure.get(key) ?? null,
    secureSet: async (key: string, value: string) => void secure.set(key, value),
    secureFallbackGet: (key: string) => secure.get(key) ?? null,
  }
  const storeA = createAgentWorkspaceStore(
    createDeps(storage, { ...sharedDeps, invalidation: hub.endpoint() }),
  )
  const storeB = createAgentWorkspaceStore(
    createDeps(storage, { ...sharedDeps, invalidation: hub.endpoint() }),
  )
  const unsubscribeB = storeB.subscribe(() => {})
  await flushPromises()

  await storeA.repairPublicRaw({ workspaces: [repairedWorkspace], activeId: "ws-1" })
  await flushPromises()

  const persisted = JSON.parse(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!) as {
    _revision: string
  }
  assert.equal(persisted._revision, "101")
  assert.deepEqual(decodedCredential(secure.get("ideall:agent:workspace:ws-1:apiKey")), {
    version: 2,
    target: endpoint,
    apiKey: "bound-key",
    revision: "101",
  })
  assert.equal(storeA.revisionSnapshot(), "101")
  assert.equal(storeB.revisionSnapshot(), "101")
  assert.equal(storeB.get("ws-1")?.name, repairedWorkspace.name)
  assert.equal(storeB.resolveModel(storeB.get("ws-1")!).apiKey, "bound-key")

  const reloaded = createAgentWorkspaceStore(createDeps(storage, sharedDeps))
  await reloaded.refreshRaw()
  assert.equal(reloaded.revisionSnapshot(), "101")
  assert.equal(
    reloaded.resolveModel(reloaded.get("ws-1")!).apiKey,
    "bound-key",
    "a credential stamped with the actual repaired envelope must not look in-doubt",
  )
  unsubscribeB()
})

test("agent workspace store: ordinary cold mutation also advances a malformed raw revision floor", async () => {
  const storage = new MemoryStorage()
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    JSON.stringify({ workspaces: null, activeId: "", _revision: "200" }),
  )
  const store = createAgentWorkspaceStore(createDeps(storage))

  await store.createRaw("after corruption")

  const persisted = JSON.parse(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!) as {
    _revision: string
  }
  assert.equal(persisted._revision, "201")
  assert.equal(store.revisionSnapshot(), "201")
})

test("agent workspace store: exhausted clean revision rejects mutation without touching durable state", async () => {
  const storage = new MemoryStorage()
  const secure = new Map<string, string>()
  const key = "ideall:agent:workspace:ws-1:apiKey"
  const endpoint = "https://api.example.test/v1"
  const initial = workspace("ws-1", {
    model: { useGlobal: false, baseURL: endpoint, model: "m", apiKey: "" },
  })
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [initial], activeId: initial.id }, MAX_WORKSPACE_REVISION),
  )
  secure.set(key, credential(endpoint, "stable-key", MAX_WORKSPACE_REVISION))
  const deps = createDeps(storage, {
    secureGet: async (secureKey) => secure.get(secureKey) ?? null,
    secureSet: async (secureKey, value) => void secure.set(secureKey, value),
    secureFallbackGet: (secureKey) => secure.get(secureKey) ?? null,
  })
  const store = createAgentWorkspaceStore(deps)
  await store.refreshRaw()
  const rawBefore = storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)
  const secureBefore = secure.get(key)

  await store.setActiveRaw("ws-1")
  await store.updateRaw("ws-1", (current) => current)
  await store.deleteRaw("missing")
  await store.replacePublicRaw(store.getState())
  assert.equal(
    storage.getItem(AGENT_WORKSPACES_STORAGE_KEY),
    rawBefore,
    "setActive current, identity update, delete missing and same-body replace must remain no-ops",
  )
  assert.equal(secure.get(key), secureBefore)
  assert.equal(store.revisionSnapshot(), MAX_WORKSPACE_REVISION)

  await assert.rejects(
    store.updateRaw("ws-1", (current) => ({ ...current, name: "must not commit" })),
    /revision space is exhausted/,
  )

  assert.equal(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY), rawBefore)
  assert.equal(secure.get(key), secureBefore)
  assert.equal(store.get("ws-1")?.name, initial.name)
  const reloaded = createAgentWorkspaceStore(deps)
  await reloaded.refreshRaw()
  assert.equal(reloaded.revisionSnapshot(), MAX_WORKSPACE_REVISION)
  assert.equal(reloaded.resolveModel(reloaded.get("ws-1")!).apiKey, "stable-key")
})

test("agent workspace store: exhausted rewrite rejects before secure and public writes", async () => {
  const storage = new MemoryStorage()
  const secure = new Map<string, string>()
  const endpoint = "https://api.example.test/v1"
  const initial = workspace("ws-1", {
    model: { useGlobal: false, baseURL: endpoint, model: "m", apiKey: "plaintext-key" },
  })
  const raw = JSON.stringify({
    workspaces: [initial],
    activeId: initial.id,
    _revision: MAX_WORKSPACE_REVISION,
  })
  storage.seed(AGENT_WORKSPACES_STORAGE_KEY, raw)
  let secureSetCalls = 0
  const deps = createDeps(storage, {
    secureGet: async (key) => secure.get(key) ?? null,
    secureSet: async (key, value) => {
      secureSetCalls += 1
      secure.set(key, value)
    },
    secureFallbackGet: (key) => secure.get(key) ?? null,
  })
  const store = createAgentWorkspaceStore(deps)

  await assert.rejects(store.refreshRaw(), /revision space is exhausted/)

  assert.equal(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY), raw)
  assert.equal(secureSetCalls, 0)
  assert.equal(secure.size, 0)
  assert.equal(store.revisionSnapshot(), MAX_WORKSPACE_REVISION)
  const reloaded = createAgentWorkspaceStore(deps)
  assert.equal(reloaded.revisionSnapshot(), MAX_WORKSPACE_REVISION)
})

test("agent workspace store: the revision immediately below max can commit max", async () => {
  const storage = new MemoryStorage()
  const initial = workspace("ws-1")
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [initial], activeId: initial.id }, BEFORE_MAX_WORKSPACE_REVISION),
  )
  const deps = createDeps(storage)
  const store = createAgentWorkspaceStore(deps)

  await store.updateRaw("ws-1", (current) => ({ ...current, name: "last revision" }))

  const persisted = JSON.parse(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!) as {
    _revision: string
  }
  assert.equal(persisted._revision, MAX_WORKSPACE_REVISION)
  assert.equal(store.revisionSnapshot(), MAX_WORKSPACE_REVISION)
  const reloaded = createAgentWorkspaceStore(deps)
  await reloaded.refreshRaw()
  assert.equal(reloaded.revisionSnapshot(), MAX_WORKSPACE_REVISION)
  assert.equal(reloaded.get("ws-1")?.name, "last revision")
})

test("agent workspace store: unavailable Storage rolls secure state back", async () => {
  const storage = new MemoryStorage()
  const secure = new Map<string, string>()
  const key = "ideall:agent:workspace:ws-1:apiKey"
  const endpoint = "https://api.example.test/v1"
  const initial = workspace("ws-1", {
    model: { useGlobal: false, baseURL: endpoint, model: "m", apiKey: "" },
  })
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [initial], activeId: initial.id }, 1),
  )
  secure.set(key, credential(endpoint, "old-key"))
  let storageAvailable = true
  const store = createAgentWorkspaceStore(
    createDeps(storage, {
      storage: () => (storageAvailable ? storage : undefined),
      secureGet: async (secureKey) => secure.get(secureKey) ?? null,
      secureSet: async (secureKey, value) => void secure.set(secureKey, value),
      secureFallbackGet: (secureKey) => secure.get(secureKey) ?? null,
    }),
  )
  await store.refreshRaw()
  storageAvailable = false

  await assert.rejects(
    store.updateRaw("ws-1", (current) => ({
      ...current,
      model: { ...current.model, apiKey: "new-key" },
    })),
    /durable storage is unavailable/,
  )
  assert.equal(store.revisionSnapshot(), "1")
  assert.equal(store.resolveModel(store.get("ws-1")!).apiKey, "old-key")
  assert.equal(decodedCredential(secure.get(key))?.apiKey, "old-key")
})

test("agent workspace store: rollback failure stays fail-closed across reload until recovery", async () => {
  const storage = new MemoryStorage()
  const secure = new Map<string, string>()
  const key = "ideall:agent:workspace:ws-1:apiKey"
  const endpoint = "https://api.example.test/v1"
  const initial = workspace("ws-1", {
    model: { useGlobal: false, baseURL: endpoint, model: "m", apiKey: "" },
  })
  storage.seed(
    AGENT_WORKSPACES_STORAGE_KEY,
    envelope({ workspaces: [initial], activeId: initial.id }, 1),
  )
  secure.set(key, credential(endpoint, "old-key"))
  let failRollback = false
  let secureSetCalls = 0
  const deps = createDeps(storage, {
    secureGet: async (secureKey) => secure.get(secureKey) ?? null,
    secureSet: async (secureKey, value) => {
      secureSetCalls += 1
      if (failRollback && secureSetCalls === 2) throw new Error("rollback unavailable")
      secure.set(secureKey, value)
    },
    secureFallbackGet: (secureKey) => secure.get(secureKey) ?? null,
  })
  const store = createAgentWorkspaceStore(deps)
  await store.refreshRaw()
  storage.failNextSet = new Error("quota exceeded")
  failRollback = true
  secureSetCalls = 0

  await assert.rejects(
    store.updateRaw("ws-1", (current) => ({
      ...current,
      model: { ...current.model, apiKey: "new-key" },
    })),
    /persistence and credential rollback both failed/,
  )
  assert.equal(store.resolveModel(store.get("ws-1")!).apiKey, "")
  assert.equal(decodedCredential(secure.get(key))?.apiKey, "new-key")
  assert.equal(decodedCredential(secure.get(key))?.revision, "2")

  const reloaded = createAgentWorkspaceStore(deps)
  assert.equal(
    reloaded.resolveModel(reloaded.get("ws-1")!).apiKey,
    "",
    "synchronous fallback materialization must reject record-ahead credentials",
  )
  failRollback = false
  secureSetCalls = 0
  await reloaded.refreshRaw()
  assert.equal(reloaded.resolveModel(reloaded.get("ws-1")!).apiKey, "")
  assert.deepEqual(decodedCredential(secure.get(key)), {
    version: 2,
    target: null,
    apiKey: "",
    revision: "2",
  })
  assert.equal(reloaded.revisionSnapshot(), "2")
})
