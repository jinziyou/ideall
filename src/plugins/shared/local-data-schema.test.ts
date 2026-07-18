import { test } from "node:test"
import assert from "node:assert/strict"
import { AUTH_TOKEN_SECURE_KEY } from "@/lib/auth/auth-store"
import { SYNC_CODE_SECURE_KEY } from "@/lib/sync-code"
import { secureFallbackStorageKey } from "@/lib/secure-store"
import { IDB_DATABASE_NAME, IDB_DATABASE_VERSION } from "@/lib/idb"
import {
  CAPTURE_ONBOARDING_STORAGE_KEY,
  FILE_TREE_EXPANDED_STORAGE_KEY,
  THEME_KEY,
} from "@/lib/public-config"
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
  LOCAL_DATA_STORAGE_CLASSES,
  inspectLocalDataSchemas,
  isLocalDataRecord,
  listLocalDataSchemas,
  registerLocalDataSchemas,
  repairLocalDataSchema,
  type LocalDataSchema,
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

test("inspectLocalDataSchemas: agent local database reports v19 stale and v20 current", async () => {
  const dispose = registerTestSchemas()
  try {
    assert.equal(IDB_DATABASE_VERSION, 20)
    const stale = await inspectLocalDataSchemas({
      indexedDBDatabases: async () => [{ name: IDB_DATABASE_NAME, version: 19 }],
    })
    const current = await inspectLocalDataSchemas({
      indexedDBDatabases: async () => [{ name: IDB_DATABASE_NAME, version: IDB_DATABASE_VERSION }],
    })

    assert.equal(stale.find((row) => row.id === "agent.tasks")?.status, "warning")
    assert.match(stale.find((row) => row.id === "agent.tasks")?.detail ?? "", /期望 v20/)
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

test("public config schemas: removes malformed capture onboarding state", async () => {
  const data: Record<string, string> = {
    [CAPTURE_ONBOARDING_STORAGE_KEY]: JSON.stringify({ version: 1, phase: "unknown" }),
  }
  const localStorage = mutableMemoryStorage(data)

  const repaired = await repairLocalDataSchema("capture.onboarding", { localStorage })

  assert.equal(repaired.ok, true)
  assert.equal(data[CAPTURE_ONBOARDING_STORAGE_KEY], undefined)
})

test("storage classes: 全部已注册 schema 均带合法 XDG 存储类", () => {
  const dispose = registerTestSchemas()
  try {
    const schemas = listLocalDataSchemas()
    assert.equal(schemas.length, 28)
    for (const schema of schemas) {
      assert.ok(
        LOCAL_DATA_STORAGE_CLASSES.includes(schema.storageClass),
        `${schema.id} 缺少合法 storageClass`,
      )
    }
    const byId = new Map(schemas.map((schema) => [schema.id, schema]))
    assert.equal(byId.get("auth.token")?.storageClass, "secrets")
    assert.equal(byId.get("sync.code")?.storageClass, "secrets")
    assert.equal(byId.get("workspace.session")?.storageClass, "runtime")
    assert.equal(byId.get("workspace.local")?.storageClass, "state")
    assert.equal(byId.get("display.engine-preferences")?.storageClass, "config")
    assert.equal(byId.get("search.semantic-enabled")?.storageClass, "config")
    assert.equal(byId.get("home.device-id")?.storageClass, "state")
    assert.equal(byId.get("tool.search-history")?.storageClass, "state")
    assert.equal(byId.get("shell.runtime-extensions")?.storageClass, "config")
    assert.equal(byId.get("agent.oauth")?.storageClass, "state")
    assert.equal(byId.get("agent.oauth")?.sensitive, true)
    assert.equal(byId.get("agent.tasks")?.storageClass, "data")
    assert.equal(byId.get("agent.tasks")?.storeClasses?.["local_search_index"], "cache")
    assert.equal(byId.get("agent.tasks")?.storeClasses?.["local_semantic_index"], "cache")
    assert.equal(byId.get("agent.tasks")?.storeClasses?.["agent_write_audit"], "state")
    assert.equal(byId.get("audio.db")?.storeClasses?.["state"], "state")
    assert.equal(byId.get("audio.db")?.storeClasses?.["tracks"], "data")
  } finally {
    dispose()
  }
})

test("storage classes: inspection 透传 storageClass 与 storeClasses", async () => {
  const dispose = registerTestSchemas()
  try {
    const rows = await inspectLocalDataSchemas({
      localStorage: memoryStorage({}),
      indexedDBDatabases: async () => [{ name: IDB_DATABASE_NAME, version: IDB_DATABASE_VERSION }],
    })
    const byId = new Map(rows.map((row) => [row.id, row]))
    assert.equal(byId.get("appearance.theme")?.storageClass, "config")
    assert.equal(byId.get("agent.tasks")?.storeClasses?.["nodes"], "data")
    assert.equal(byId.get("agent.tasks")?.storeClasses?.["local_search_index"], "cache")
  } finally {
    dispose()
  }
})

function storageClassProbe(overrides: Partial<LocalDataSchema>): LocalDataSchema {
  return {
    id: "test.storage-class-probe",
    label: "探针",
    owner: "test",
    storage: "localStorage",
    key: "test:storage-class-probe",
    currentVersion: 1,
    storageClass: "config",
    ...overrides,
  }
}

test("storage classes: cache/runtime/secrets 不得 portable，secrets 必标 sensitive", () => {
  for (const storageClass of ["cache", "runtime", "secrets"] as const) {
    assert.throws(
      () =>
        registerLocalDataSchemas([
          storageClassProbe({ storageClass, portable: true, sensitive: true }),
        ]),
      /must not be portable/,
      `${storageClass} 不应允许 portable`,
    )
  }
  assert.throws(
    () => registerLocalDataSchemas([storageClassProbe({ storageClass: "secrets" })]),
    /must be marked sensitive/,
  )
  assert.throws(
    () =>
      registerLocalDataSchemas([
        storageClassProbe({ storageClass: "bogus" as LocalDataSchema["storageClass"] }),
      ]),
    /Invalid storage class/,
  )
  // 合法 secrets（sensitive + 非 portable）与合法 config 可注册并精确注销。
  const dispose = registerLocalDataSchemas([
    storageClassProbe({
      id: "test.storage-class-secrets",
      storageClass: "secrets",
      sensitive: true,
    }),
  ])
  dispose()
})

test("storage classes: storeClasses 仅允许 indexedDB 且取值合法", () => {
  assert.throws(
    () => registerLocalDataSchemas([storageClassProbe({ storeClasses: { nodes: "data" } })]),
    /requires indexedDB storage/,
  )
  assert.throws(
    () =>
      registerLocalDataSchemas([
        storageClassProbe({
          storage: "indexedDB",
          storeClasses: { "": "data" },
        }),
      ]),
    /invalid storeClasses entry/,
  )
  const dispose = registerLocalDataSchemas([
    storageClassProbe({
      id: "test.storage-class-idb",
      storage: "indexedDB",
      storeClasses: { nodes: "data", local_search_index: "cache" },
    }),
  ])
  dispose()
})

test("storage classes: dynamicKeys 家族禁 indexedDB 且 validate-only", () => {
  assert.throws(
    () =>
      registerLocalDataSchemas([
        storageClassProbe({
          storage: "indexedDB",
          dynamicKeys: { enumerate: () => [] },
        }),
      ]),
    /dynamicKeys forbids indexedDB/,
  )
  assert.throws(
    () =>
      registerLocalDataSchemas([
        storageClassProbe({
          dynamicKeys: { enumerate: () => [] },
          repair: () => null,
        }),
      ]),
    /validate-only/,
  )
  const dispose = registerLocalDataSchemas([
    storageClassProbe({ id: "test.storage-class-dynamic", dynamicKeys: { enumerate: () => [] } }),
  ])
  dispose()
})

test("S1b 补登记: 语义开关/设备标识/搜索历史/扩展安装记录的校验与修复", async () => {
  const dispose = registerTestSchemas()
  const data: Record<string, string> = {
    "ideall:semantic-search:v1": "yes",
    "ideall:device:v1": "  ",
    "tool:search:history": JSON.stringify(["ok", 42, "fine", null]),
    "ideall:runtime-extensions:v2": JSON.stringify({
      version: 2,
      records: [
        { id: "a", version: 1, digest: "d", permissionDigest: "p", consentReceipt: "c" },
        { id: "", version: 1 },
      ],
    }),
  }
  const localStorage = mutableMemoryStorage(data)
  try {
    const rows = await inspectLocalDataSchemas({ localStorage })
    const byId = new Map(rows.map((row) => [row.id, row]))
    assert.equal(byId.get("search.semantic-enabled")?.status, "warning")
    assert.equal(byId.get("home.device-id")?.status, "warning")
    assert.equal(byId.get("tool.search-history")?.status, "warning")
    assert.equal(byId.get("shell.runtime-extensions")?.status, "warning")

    assert.equal(
      (await repairLocalDataSchema("search.semantic-enabled", { localStorage })).ok,
      true,
    )
    assert.equal(data["ideall:semantic-search:v1"], undefined)
    assert.equal((await repairLocalDataSchema("home.device-id", { localStorage })).ok, true)
    assert.equal(data["ideall:device:v1"], undefined)
    assert.equal((await repairLocalDataSchema("tool.search-history", { localStorage })).ok, true)
    assert.deepEqual(JSON.parse(data["tool:search:history"]!), ["ok", "fine"])
    const repaired = await repairLocalDataSchema("shell.runtime-extensions", { localStorage })
    assert.equal(repaired.ok, true)
    const installs = JSON.parse(data["ideall:runtime-extensions:v2"]!)
    assert.equal(installs.records.length, 1)
    assert.equal(installs.records[0].id, "a")
  } finally {
    dispose()
  }
})

test("S1b 补登记: OAuth 动态家族按实际键逐项展开,明文残留标警告", async () => {
  const dispose = registerTestSchemas()
  try {
    // 生产 agent.oauth 枚举读全局 localStorage（node 测试环境无）→ 家族无实际键时给一行 missing 占位。
    const empty = await inspectLocalDataSchemas({ localStorage: memoryStorage({}) })
    const emptyRows = empty.filter((row) => row.id === "agent.oauth")
    assert.equal(emptyRows.length, 1)
    assert.equal(emptyRows[0]?.status, "missing")
  } finally {
    dispose()
  }
})

test("dynamicKeys 家族: inspect 按枚举键逐项展开并保留 validate", async () => {
  const dispose = registerLocalDataSchemas([
    storageClassProbe({
      id: "test.dynamic-family",
      storageClass: "state",
      parseAs: "json",
      dynamicKeys: { enumerate: () => ["test:dyn:a", "test:dyn:b"] },
      validate: (value) =>
        isLocalDataRecord(value) && (value as { bad?: unknown }).bad === true
          ? ["含 bad 标记"]
          : [],
    }),
  ])
  try {
    const rows = await inspectLocalDataSchemas({
      localStorage: memoryStorage({
        "test:dyn:a": JSON.stringify({ ok: true }),
        "test:dyn:b": JSON.stringify({ bad: true }),
      }),
    })
    const family = rows.filter((row) => row.id === "test.dynamic-family")
    assert.equal(family.length, 2)
    const byKey = new Map(family.map((row) => [row.key, row]))
    assert.equal(byKey.get("test:dyn:a")?.status, "ok")
    assert.equal(byKey.get("test:dyn:b")?.status, "warning")
    assert.equal(byKey.get("test:dyn:b")?.repairable, false)
  } finally {
    dispose()
  }
})
