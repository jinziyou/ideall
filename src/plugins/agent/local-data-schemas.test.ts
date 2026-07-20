import assert from "node:assert/strict"
import { test } from "node:test"
import { AGENT_TASKS_FILE_REF, AGENT_WORKSPACES_FILE_REF } from "@/filesystem/builtin-app-roots"
import { withFileWriteLock } from "@/filesystem/write-lock"
import { registerLocalDataSchemas, repairLocalDataSchema } from "@/plugins/shared/local-data-schema"
import { agentLocalDataSchemas } from "./local-data-schemas"
import { AGENT_WORKSPACES_STORAGE_KEY } from "./lib/agent-workspace"

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

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
    this.values.set(key, value)
  }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("agent workspace schema repair holds tasks→workspaces and commits through the revision store", async () => {
  const previousWindow = globalThis.window
  const previousLocalStorage = globalThis.localStorage
  const storage = new MemoryStorage()
  const originalRaw = JSON.stringify({
    activeId: "ws-test",
    workspaces: [
      {
        id: "ws-test",
        name: "Workspace",
        model: {
          useGlobal: false,
          baseURL: "https://api.example.test/v1",
          model: "model",
          apiKey: "legacy-plaintext",
        },
      },
    ],
    _revision: "7",
  })
  storage.setItem(AGENT_WORKSPACES_STORAGE_KEY, originalRaw)
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    configurable: true,
  })
  const unregister = registerLocalDataSchemas(agentLocalDataSchemas)
  const workspaceLockEntered = deferred()
  const releaseWorkspaceLock = deferred()
  const workspaceHolder = withFileWriteLock(AGENT_WORKSPACES_FILE_REF, async () => {
    workspaceLockEntered.resolve()
    await releaseWorkspaceLock.promise
  })
  await workspaceLockEntered.promise

  let taskWriterEntered = false
  let repair: Promise<Awaited<ReturnType<typeof repairLocalDataSchema>>> | undefined
  let taskWriter: Promise<void> | undefined
  try {
    repair = repairLocalDataSchema("agent.workspaces")
    taskWriter = withFileWriteLock(AGENT_TASKS_FILE_REF, () => {
      taskWriterEntered = true
    })
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(taskWriterEntered, false, "repair must retain tasks while waiting for workspaces")
    assert.equal(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY), originalRaw)

    releaseWorkspaceLock.resolve()
    const result = await repair
    await taskWriter
    assert.equal(result.ok, true)
    assert.equal(
      result.before.status,
      "ok",
      "the owner refresh should scrub revisioned plaintext before the generic repair inspects it",
    )
    assert.equal(result.after?.status, "ok")
    assert.equal(result.detail, "无需修复")
    assert.equal(taskWriterEntered, true)

    const persisted = JSON.parse(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!) as {
      _revision?: string
      activeId?: string
      workspaces?: Array<{ id?: string; model?: { apiKey?: string } }>
    }
    assert.equal(persisted._revision, "8")
    assert.equal(persisted.workspaces?.length, 1)
    assert.equal(persisted.activeId, persisted.workspaces?.[0]?.id)
    assert.equal(persisted.workspaces?.[0]?.model?.apiKey, "")

    // Corrupt JSON cannot be self-hydrated. The owner apply hook must still rebuild it through the
    // Raw store, advancing from the last accepted revision instead of patching localStorage.
    storage.setItem(AGENT_WORKSPACES_STORAGE_KEY, "{bad")
    const rebuilt = await repairLocalDataSchema("agent.workspaces")
    assert.equal(rebuilt.ok, true)
    assert.equal(rebuilt.before.status, "error")
    assert.equal(rebuilt.after?.status, "ok")
    const rebuiltEnvelope = JSON.parse(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!) as {
      _revision?: string
      activeId?: string
      workspaces?: Array<{ id?: string; model?: { apiKey?: string } }>
    }
    assert.equal(rebuiltEnvelope._revision, "9")
    assert.equal(rebuiltEnvelope.workspaces?.length, 1)
    assert.equal(rebuiltEnvelope.activeId, rebuiltEnvelope.workspaces?.[0]?.id)

    // An invalid revision with otherwise identical public content is rejected by hydration. Repair
    // must force a fresh envelope commit instead of taking the ordinary same-state no-op path.
    storage.setItem(
      AGENT_WORKSPACES_STORAGE_KEY,
      JSON.stringify({ ...rebuiltEnvelope, _revision: "invalid" }),
    )
    const repairedRevision = await repairLocalDataSchema("agent.workspaces")
    assert.equal(repairedRevision.ok, true)
    assert.equal(repairedRevision.before.status, "warning")
    assert.equal(repairedRevision.after?.status, "ok")
    const revisionEnvelope = JSON.parse(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!) as {
      _revision?: string
      activeId?: string
      workspaces?: Array<{ id?: string }>
    }
    assert.equal(revisionEnvelope._revision, "10")
    assert.equal(revisionEnvelope.activeId, rebuiltEnvelope.activeId)
    assert.deepEqual(
      revisionEnvelope.workspaces?.map((workspace) => workspace.id),
      rebuiltEnvelope.workspaces?.map((workspace) => workspace.id),
    )

    storage.setItem(
      AGENT_WORKSPACES_STORAGE_KEY,
      JSON.stringify({ workspaces: [], activeId: "missing", _revision: "11" }),
    )
    const repairedStructure = await repairLocalDataSchema("agent.workspaces")
    assert.equal(repairedStructure.ok, true)
    assert.equal(repairedStructure.before.status, "warning")
    assert.equal(repairedStructure.after?.status, "ok")
    const structureEnvelope = JSON.parse(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)!) as {
      _revision?: string
      activeId?: string
      workspaces?: Array<{ id?: string }>
    }
    assert.equal(
      structureEnvelope._revision,
      "12",
      "a structurally invalid envelope must still contribute its valid monotonic revision floor",
    )
    assert.equal(structureEnvelope.workspaces?.length, 1)
    assert.equal(structureEnvelope.activeId, structureEnvelope.workspaces?.[0]?.id)
  } finally {
    releaseWorkspaceLock.resolve()
    await Promise.allSettled([workspaceHolder, repair, taskWriter].filter(Boolean))
    unregister()
    Object.defineProperty(globalThis, "window", { value: previousWindow, configurable: true })
    Object.defineProperty(globalThis, "localStorage", {
      value: previousLocalStorage,
      configurable: true,
    })
  }
})
