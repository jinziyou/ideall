import { BASE } from "../lib.mjs"

export const SHOT_DIR = "/tmp/plugins-smoke"
export const RUN_ID = Date.now()
export const AUDIO_TITLE = `ideall-plugin-audio-${RUN_ID}`
export const TABLE_NAME = `ideall_plugin_table_${RUN_ID}`
export const SECRET_TOKEN = `code-secret-${RUN_ID}`
export const LEGACY_SYNC_CODE = "0123456789abcdef0123456789abcdef"
export const LEGACY_AUTH_TOKEN = `legacy-auth-token-${RUN_ID}`
export const LEGACY_AGENT_KEY = `sk-legacy-agent-${RUN_ID}`
export const LEGACY_MCP_SECRET = `legacy-mcp-secret-${RUN_ID}`
export const LEGACY_WORKSPACE_KEY = `legacy-workspace-key-${RUN_ID}`
export const LEGACY_WORKSPACE_ID = `smoke-ws-${RUN_ID}`
export const AGENT_SETTINGS_KEY = "wonita:agent:settings"
export const AGENT_SETTINGS_CANONICAL_KEY = "ideall:agent:settings"
export const AGENT_SECRETS_KEY = "ideall:agent:secrets:v1"
export const AGENT_WORKSPACES_KEY = "ideall:agent:workspaces:v1"
export const LEGACY_AUTH_TOKEN_KEY = "wonita:auth:token"
export const LEGACY_AUTH_USER_KEY = "wonita:auth:user"
export const LEGACY_SYNC_CODE_KEY = "wonita:sync:code"
export const WORKSPACE_KEY = "ideall:workspace:v1"
export const GIT_REPOS_KEY = "ideall:git:repos"
export const CODE_IMPORT_REPO = `/tmp/ideall-code-import-${RUN_ID}`

const PLUGIN_SURFACES = {
  audio: { fileSystemId: "app.audio-library", engineId: "ideall.audio" },
  database: { fileSystemId: "app.database", engineId: "ideall.database" },
  git: { fileSystemId: "app.git-repositories", engineId: "ideall.git" },
}

export async function deleteDb(page, name) {
  await page.evaluate(
    async (dbName) =>
      new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(dbName)
        req.onsuccess = () => resolve(true)
        req.onerror = () => resolve(false)
        req.onblocked = () => resolve(false)
      }),
    name,
  )
}

export async function resetWorkspace(page) {
  await page.evaluate((key) => {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  }, WORKSPACE_KEY)
}

export async function openPluginPage(page, path) {
  await resetWorkspace(page).catch(() => {})
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 })
}

/** 直接打开 App FileSystem 根；旧 /audio、/git、/database 路由现在只负责切换 Workspace Dock。 */
export async function openPluginSurface(page, id) {
  const surface = PLUGIN_SURFACES[id]
  if (!surface) throw new Error(`unknown plugin surface: ${id}`)
  const search = new URLSearchParams({
    file: `${surface.fileSystemId}:root`,
    engine: surface.engineId,
  })
  await openPluginPage(page, `/home?${search}`)
}

export async function seedLegacySecurityData(page) {
  await page.evaluate(
    ({
      authToken,
      authTokenKey,
      authUserKey,
      syncCode,
      syncCodeKey,
      agentSettingsKey,
      agentKey,
      agentSecretsKey,
      mcpSecret,
      agentWorkspacesKey,
      workspaceId,
      workspaceKey,
    }) => {
      localStorage.setItem(syncCodeKey, syncCode)
      localStorage.setItem(authTokenKey, authToken)
      localStorage.setItem(
        authUserKey,
        JSON.stringify({
          id: 1,
          email: "smoke@example.test",
          name: "Smoke",
          avatar: null,
        }),
      )
      localStorage.setItem(
        agentSettingsKey,
        JSON.stringify({
          baseURL: "https://api.example.test/v1",
          model: "smoke-model",
          apiKey: agentKey,
          includeHomeContext: true,
          defaultAgentMode: true,
          approvalPolicy: "confirm",
        }),
      )
      localStorage.setItem(
        agentSecretsKey,
        JSON.stringify([{ id: "SMOKE_SECRET", value: mcpSecret }]),
      )
      localStorage.setItem(
        agentWorkspacesKey,
        JSON.stringify({
          workspaces: [
            {
              id: workspaceId,
              name: "Smoke Workspace",
              model: {
                useGlobal: false,
                baseURL: "https://api.example.test/v1",
                model: "smoke-workspace",
                apiKey: workspaceKey,
              },
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
          activeId: workspaceId,
        }),
      )
    },
    {
      authToken: LEGACY_AUTH_TOKEN,
      authTokenKey: LEGACY_AUTH_TOKEN_KEY,
      authUserKey: LEGACY_AUTH_USER_KEY,
      syncCode: LEGACY_SYNC_CODE,
      syncCodeKey: LEGACY_SYNC_CODE_KEY,
      agentSettingsKey: AGENT_SETTINGS_KEY,
      agentKey: LEGACY_AGENT_KEY,
      agentSecretsKey: AGENT_SECRETS_KEY,
      mcpSecret: LEGACY_MCP_SECRET,
      agentWorkspacesKey: AGENT_WORKSPACES_KEY,
      workspaceId: LEGACY_WORKSPACE_ID,
      workspaceKey: LEGACY_WORKSPACE_KEY,
    },
  )
}

export async function readSecurityMigrationState(page) {
  return page.evaluate(
    ({
      authTokenKey,
      authSecureKey,
      syncCodeKey,
      syncSecureKey,
      agentSettingsKey,
      agentSettingsCanonicalKey,
      agentSecureKey,
      agentSecretsKey,
      secretSecureKey,
      agentWorkspacesKey,
      workspaceSecureKey,
    }) => {
      const fallbackKey = (key) => `ideall:secure-fallback:${key}`
      const readJson = (key, fallback) => {
        try {
          return JSON.parse(localStorage.getItem(key) || fallback)
        } catch {
          return null
        }
      }
      const readWorkspaceCredential = (key) => {
        const raw = localStorage.getItem(key)
        if (raw === null) return null
        try {
          const credential = JSON.parse(raw)
          return credential?.version === 2 && typeof credential.apiKey === "string"
            ? credential.apiKey
            : raw
        } catch {
          return raw
        }
      }
      const settings = readJson(agentSettingsKey, "{}")
      const canonicalSettings = readJson(agentSettingsCanonicalKey, "{}")
      const secrets = readJson(agentSecretsKey, "[]")
      const workspaces = readJson(agentWorkspacesKey, "{}")
      return {
        legacyAuthToken: localStorage.getItem(authTokenKey),
        legacySyncCode: localStorage.getItem(syncCodeKey),
        fallbackAuthToken: localStorage.getItem(fallbackKey(authSecureKey)),
        fallbackSyncCode: localStorage.getItem(fallbackKey(syncSecureKey)),
        fallbackAgentKey: localStorage.getItem(fallbackKey(agentSecureKey)),
        fallbackSecret: localStorage.getItem(fallbackKey(secretSecureKey)),
        fallbackWorkspaceKey: readWorkspaceCredential(fallbackKey(workspaceSecureKey)),
        // 诊断读取会先把 wonita 旧键规范化成 ideall 键，再由显式迁移动作写入
        // secure-store；三个阶段都代表“已识别”，冒烟不能只观察首尾两态。
        publicAgentApiKey: settings?.apiKey ?? canonicalSettings?.apiKey,
        publicSecretValue: Array.isArray(secrets) ? secrets[0]?.value : undefined,
        publicWorkspaceDump: JSON.stringify(workspaces),
      }
    },
    {
      authTokenKey: LEGACY_AUTH_TOKEN_KEY,
      authSecureKey: "ideall:auth:token",
      syncCodeKey: LEGACY_SYNC_CODE_KEY,
      syncSecureKey: "ideall:sync:code",
      agentSettingsKey: AGENT_SETTINGS_KEY,
      agentSettingsCanonicalKey: AGENT_SETTINGS_CANONICAL_KEY,
      agentSecureKey: "ideall:agent:settings:apiKey",
      agentSecretsKey: AGENT_SECRETS_KEY,
      secretSecureKey: "ideall:agent:secret:SMOKE_SECRET",
      agentWorkspacesKey: AGENT_WORKSPACES_KEY,
      workspaceSecureKey: `ideall:agent:workspace:${LEGACY_WORKSPACE_ID}:apiKey`,
    },
  )
}

export async function cleanupPluginSmokeData(page) {
  await deleteDb(page, "ideall:audio")
  await deleteDb(page, "ideall:database")
  await page.evaluate(() => localStorage.removeItem("ideall-smoke-token")).catch(() => {})
  await page.evaluate((key) => localStorage.removeItem(key), GIT_REPOS_KEY).catch(() => {})
  await page
    .evaluate(
      (keys) => {
        for (const key of keys) localStorage.removeItem(key)
      },
      [
        LEGACY_AUTH_TOKEN_KEY,
        LEGACY_AUTH_USER_KEY,
        LEGACY_SYNC_CODE_KEY,
        AGENT_SETTINGS_KEY,
        AGENT_SETTINGS_CANONICAL_KEY,
        AGENT_SECRETS_KEY,
        AGENT_WORKSPACES_KEY,
        "ideall:secure-fallback:ideall:auth:token",
        "ideall:secure-fallback:ideall:sync:code",
        "ideall:secure-fallback:ideall:agent:settings:apiKey",
        "ideall:secure-fallback:ideall:agent:secret:SMOKE_SECRET",
        `ideall:secure-fallback:ideall:agent:workspace:${LEGACY_WORKSPACE_ID}:apiKey`,
      ],
    )
    .catch(() => {})
}
