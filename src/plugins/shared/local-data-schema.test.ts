import { test } from "node:test"
import assert from "node:assert/strict"
import { AUTH_TOKEN_SECURE_KEY } from "@/lib/auth/auth-store"
import { SYNC_CODE_SECURE_KEY } from "@/lib/sync-code"
import { secureFallbackStorageKey } from "@/lib/secure-store"
import { AUDIO_DB_NAME, AUDIO_DB_VERSION } from "@/plugins/audio/audio-store"
import { AGENT_SECRETS_STORAGE_KEY } from "@/plugins/agent/lib/agent-secrets"
import { AGENT_SETTINGS_STORAGE_KEY } from "@/plugins/agent/lib/agent-settings"
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

test("repairLocalDataSchema: 移除损坏 JSON 并清理旧明文字段", async () => {
  const dispose = registerTestSchemas()
  const localData = {
    [AGENT_SETTINGS_STORAGE_KEY]: JSON.stringify({ model: "x", apiKey: "sk-legacy" }),
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
  } finally {
    dispose()
  }
})
