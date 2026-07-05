import { test } from "node:test"
import assert from "node:assert/strict"
import { SYNC_CODE_STORAGE_KEY } from "@/lib/sync-code"
import { AUDIO_DB_NAME, AUDIO_DB_VERSION } from "@/plugins/audio/audio-store"
import { AGENT_SECRETS_STORAGE_KEY } from "@/plugins/agent/lib/agent-secrets"
import { AGENT_SETTINGS_STORAGE_KEY } from "@/plugins/agent/lib/agent-settings"
import { GIT_REPOS_STORAGE_KEY } from "@/plugins/git/git-repos-store"
import { inspectLocalDataSchemas, repairLocalDataSchema } from "./local-data-schema"

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
  const localStorage = memoryStorage({
    [GIT_REPOS_STORAGE_KEY]: JSON.stringify(["/repo/a"]),
    [AGENT_SETTINGS_STORAGE_KEY]: JSON.stringify({ apiKey: "sk-legacy" }),
    [AGENT_SECRETS_STORAGE_KEY]: JSON.stringify([{ id: "TOK", value: "secret" }]),
    [SYNC_CODE_STORAGE_KEY]: "abc",
  })
  const sessionStorage = memoryStorage({
    "ideall:workspace:v1": "{bad",
  })
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
  assert.equal(byId.get("audio.db")?.status, "ok")
  assert.equal(byId.get("database.db")?.status, "missing")
})

test("repairLocalDataSchema: 移除损坏 JSON 并清理旧明文字段", async () => {
  const localData = {
    [AGENT_SETTINGS_STORAGE_KEY]: JSON.stringify({ model: "x", apiKey: "sk-legacy" }),
  }
  const sessionData = {
    "ideall:workspace:v1": "{bad",
  }
  const localStorage = mutableMemoryStorage(localData)
  const sessionStorage = mutableMemoryStorage(sessionData)

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
})
