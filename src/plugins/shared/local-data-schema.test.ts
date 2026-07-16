import { test } from "node:test"
import assert from "node:assert/strict"
import { AUTH_TOKEN_SECURE_KEY } from "@/lib/auth/auth-store"
import { SYNC_CODE_SECURE_KEY } from "@/lib/sync-code"
import { secureFallbackStorageKey } from "@/lib/secure-store"
import { IDB_DATABASE_NAME, IDB_DATABASE_VERSION } from "@/lib/idb"
import { FILE_TREE_EXPANDED_STORAGE_KEY, THEME_KEY } from "@/lib/public-config"
import { AUDIO_DB_NAME, AUDIO_DB_VERSION } from "@/plugins/audio/audio-store"
import { AGENT_SECRETS_STORAGE_KEY } from "@/plugins/agent/lib/agent-secrets"
import { AGENT_SETTINGS_STORAGE_KEY } from "@/plugins/agent/lib/agent-settings"
import { AGENT_WORKSPACES_STORAGE_KEY } from "@/plugins/agent/lib/agent-workspace"
import { GIT_REPOS_STORAGE_KEY } from "@/plugins/git/git-repos-store"
import { audioManifest } from "@/plugins/audio/manifest"
import { databaseManifest } from "@/plugins/database/manifest"
import { gitManifest } from "@/plugins/git/manifest"
import { agentManifest } from "@/plugins/agent/manifest"
import { syncManifest } from "@/plugins/sync/manifest"
import {
  inspectLocalDataSchemas,
  registerLocalDataSchemas,
  repairLocalDataSchema,
} from "./local-data-schema"

function registerTestSchemas(): () => void {
  const disposers = [audioManifest, databaseManifest, gitManifest, agentManifest, syncManifest].map(
    (manifest) => registerLocalDataSchemas(manifest.localDataSchemas),
  )
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

function memoryStorage(data: Record<string, string>): Pick<Storage, "getItem"> {
  return {
    getItem: (key: string) => data[key] ?? null,
  }
}

function mutableMemoryStorage(
  data: Record<string, string>,
): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    removeItem: (key: string) => {
      delete data[key]
    },
  }
}

test("inspectLocalDataSchemas: 识别 JSON 正常、损坏和旧明文敏感值", async () => {
  const dispose = registerTestSchemas()
  const localStorage = memoryStorage({
    [GIT_REPOS_STORAGE_KEY]: JSON.stringify(["/repo/a"]),
    [AGENT_SETTINGS_STORAGE_KEY]: JSON.stringify({ apiKey: "sk-legacy" }),
    [AGENT_SECRETS_STORAGE_KEY]: JSON.stringify([{ id: "TOK", value: "secret" }]),
    [secureFallbackStorageKey(SYNC_CODE_SECURE_KEY)]: "abc",
    [secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY)]: "token",
  })
  const sessionStorage = memoryStorage({
    "ideall:workspace:v1": "{bad",
  })
  try {
    const rows = await inspectLocalDataSchemas({
      localStorage,
      sessionStorage,
      indexedDBDatabases: async () => [{ name: AUDIO_DB_NAME, version: AUDIO_DB_VERSION }],
    })
    const byId = new Map(rows.map((row) => [row.id, row]))

    assert.equal(byId.get("git.repos")?.status, "ok")
    assert.equal(byId.get("workspace.session")?.status, "error")
    assert.equal(byId.get("agent.settings")?.status, "warning")
    assert.equal(byId.get("agent.settings")?.repairable, true)
    assert.match(byId.get("agent.secrets")?.detail ?? "", /明文/)
    assert.equal(byId.get("sync.code")?.status, "warning")
    assert.equal(byId.get("sync.code")?.repairable, false)
    assert.equal(byId.get("auth.token")?.status, "warning")
    assert.equal(byId.get("audio.db")?.status, "ok")
    assert.equal(byId.get("database.db")?.status, "missing")
  } finally {
    dispose()
  }
})

test("inspectLocalDataSchemas: agent task database reports v16 stale and v17 current", async () => {
  const dispose = registerTestSchemas()
  try {
    assert.equal(IDB_DATABASE_VERSION, 17)
    const stale = await inspectLocalDataSchemas({
      indexedDBDatabases: async () => [{ name: IDB_DATABASE_NAME, version: 16 }],
    })
    const current = await inspectLocalDataSchemas({
      indexedDBDatabases: async () => [{ name: IDB_DATABASE_NAME, version: IDB_DATABASE_VERSION }],
    })

    assert.equal(stale.find((row) => row.id === "agent.tasks")?.status, "warning")
    assert.match(stale.find((row) => row.id === "agent.tasks")?.detail ?? "", /期望 v17/)
    assert.equal(current.find((row) => row.id === "agent.tasks")?.status, "ok")
  } finally {
    dispose()
  }
})

test("repairLocalDataSchema: 移除损坏 JSON 并清理旧明文字段", async () => {
  const dispose = registerTestSchemas()
  const localData = {
    [AGENT_SETTINGS_STORAGE_KEY]: JSON.stringify({ model: "x", apiKey: "sk-legacy" }),
    [AGENT_WORKSPACES_STORAGE_KEY]: JSON.stringify({
      activeId: "ws-test",
      workspaces: [{ id: "ws-test", model: { apiKey: "workspace-secret" } }],
      _revision: "9",
    }),
  }
  const sessionData = {
    "ideall:workspace:v1": "{bad",
  }
  const localStorage = mutableMemoryStorage(localData)
  const sessionStorage = mutableMemoryStorage(sessionData)

  try {
    const workspace = await repairLocalDataSchema("workspace.session", {
      localStorage,
      sessionStorage,
    })
    assert.equal(workspace.ok, true)
    assert.equal(sessionData["ideall:workspace:v1"], undefined)

    const settings = await repairLocalDataSchema("agent.settings", {
      localStorage,
      sessionStorage,
    })
    assert.equal(settings.ok, true)
    const repaired = JSON.parse(localData[AGENT_SETTINGS_STORAGE_KEY]!)
    assert.equal(repaired.apiKey, undefined)
    assert.equal(repaired.model, "x")

    // 注入 Storage 的隔离诊断仍使用通用写入面，不触碰生产 workspace singleton。
    const workspaces = await repairLocalDataSchema("agent.workspaces", {
      localStorage,
      sessionStorage,
    })
    assert.equal(workspaces.ok, true)
    const repairedWorkspaces = JSON.parse(localData[AGENT_WORKSPACES_STORAGE_KEY]!)
    assert.equal(repairedWorkspaces._revision, "9")
    assert.equal(repairedWorkspaces.workspaces[0].model.apiKey, undefined)
  } finally {
    dispose()
  }
})

test("public config schemas: repair invalid theme and filter malformed tree entries", async () => {
  const data = {
    [THEME_KEY]: "neon",
    [FILE_TREE_EXPANDED_STORAGE_KEY]: JSON.stringify(["valid", 42, null]),
  }
  const localStorage = mutableMemoryStorage(data)

  const theme = await repairLocalDataSchema("appearance.theme", { localStorage })
  const tree = await repairLocalDataSchema("navigation.file-tree-expanded", { localStorage })

  assert.equal(theme.ok, true)
  assert.equal(data[THEME_KEY], "system")
  assert.equal(tree.ok, true)
  assert.deepEqual(JSON.parse(data[FILE_TREE_EXPANDED_STORAGE_KEY]), ["valid"])
})
