// Plugin core smoke test (Playwright) against the real browser UI:
//   audio import -> database create/write/delete -> code diagnostics -> git fallback.
//
// Usage: pnpm smoke:plugins
// Optional: BASE=http://localhost:<port> pnpm smoke:plugins
// Screenshots: /tmp/plugins-smoke/*.png
import { BASE, createSilentWavBuffer, createSmokeRun, recordNoPageErrors } from "./smoke-lib.mjs"

const SHOT_DIR = "/tmp/plugins-smoke"
const RUN_ID = Date.now()
const AUDIO_TITLE = `ideall-plugin-audio-${RUN_ID}`
const TABLE_NAME = `ideall_plugin_table_${RUN_ID}`
const SECRET_TOKEN = `code-secret-${RUN_ID}`
const LEGACY_SYNC_CODE = "0123456789abcdef0123456789abcdef"
const LEGACY_AUTH_TOKEN = `legacy-auth-token-${RUN_ID}`
const LEGACY_AGENT_KEY = `sk-legacy-agent-${RUN_ID}`
const LEGACY_MCP_SECRET = `legacy-mcp-secret-${RUN_ID}`
const LEGACY_WORKSPACE_KEY = `legacy-workspace-key-${RUN_ID}`
const LEGACY_WORKSPACE_ID = `smoke-ws-${RUN_ID}`
const AGENT_SETTINGS_KEY = "wonita:agent:settings"
const AGENT_SECRETS_KEY = "ideall:agent:secrets:v1"
const AGENT_WORKSPACES_KEY = "ideall:agent:workspaces:v1"
const LEGACY_AUTH_TOKEN_KEY = "wonita:auth:token"
const LEGACY_AUTH_USER_KEY = "wonita:auth:user"
const LEGACY_SYNC_CODE_KEY = "wonita:sync:code"
const WORKSPACE_KEY = "ideall:workspace:v1"
const GIT_REPOS_KEY = "ideall:git:repos"
const CODE_IMPORT_REPO = `/tmp/ideall-code-import-${RUN_ID}`

async function deleteDb(page, name) {
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

async function resetWorkspace(page) {
  await page.evaluate((key) => {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  }, WORKSPACE_KEY)
}

async function openPluginPage(page, path) {
  await resetWorkspace(page).catch(() => {})
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 })
}

async function seedLegacySecurityData(page) {
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

async function readSecurityMigrationState(page) {
  return page.evaluate(
    ({
      authTokenKey,
      authSecureKey,
      syncCodeKey,
      syncSecureKey,
      agentSettingsKey,
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
      const settings = readJson(agentSettingsKey, "{}")
      const secrets = readJson(agentSecretsKey, "[]")
      const workspaces = readJson(agentWorkspacesKey, "{}")
      return {
        legacyAuthToken: localStorage.getItem(authTokenKey),
        legacySyncCode: localStorage.getItem(syncCodeKey),
        fallbackAuthToken: localStorage.getItem(fallbackKey(authSecureKey)),
        fallbackSyncCode: localStorage.getItem(fallbackKey(syncSecureKey)),
        fallbackAgentKey: localStorage.getItem(fallbackKey(agentSecureKey)),
        fallbackSecret: localStorage.getItem(fallbackKey(secretSecureKey)),
        fallbackWorkspaceKey: localStorage.getItem(fallbackKey(workspaceSecureKey)),
        publicAgentApiKey: settings?.apiKey,
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
      agentSecureKey: "ideall:agent:settings:apiKey",
      agentSecretsKey: AGENT_SECRETS_KEY,
      secretSecureKey: "ideall:agent:secret:SMOKE_SECRET",
      agentWorkspacesKey: AGENT_WORKSPACES_KEY,
      workspaceSecureKey: `ideall:agent:workspace:${LEGACY_WORKSPACE_ID}:apiKey`,
    },
  )
}

const run = await createSmokeRun({ shotDir: SHOT_DIR })
const { page, pageErrors, record, markStage } = run

await page.addInitScript((key) => {
  try {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  } catch {
    /* ignore storage reset failures */
  }
}, WORKSPACE_KEY)

try {
  console.log(`\n▶ 插件冒烟目标: ${BASE}\n`)

  markStage("audio")
  await page.goto(`${BASE}/home`, { waitUntil: "domcontentloaded", timeout: 30000 })
  await resetWorkspace(page)
  await deleteDb(page, "ideall:audio")
  await openPluginPage(page, "/audio")
  await page.getByRole("heading", { name: "音频播放器", exact: true }).waitFor({
    state: "visible",
    timeout: 30000,
  })
  await page.locator('input[type="file"][accept="audio/*"]').setInputFiles({
    name: `${AUDIO_TITLE}.wav`,
    mimeType: "audio/wav",
    buffer: createSilentWavBuffer(),
  })
  await page.getByText(AUDIO_TITLE, { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  record("音频插件可导入并展示本地音频", true)
  const audioDownloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 JSON", exact: true }).click()
  const audioDownload = await audioDownloadPromise
  const audioExportPath = await audioDownload.path()
  if (!audioExportPath) throw new Error("audio JSON export path unavailable")
  record("音频插件可导出 JSON 备份", true)
  await openPluginPage(page, "/home")
  await deleteDb(page, "ideall:audio")
  await openPluginPage(page, "/audio")
  await page
    .locator('input[type="file"][accept="application/json,.json"]')
    .setInputFiles(audioExportPath)
  await page.getByText(AUDIO_TITLE, { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  record("音频插件可从 JSON 备份恢复", true)
  await page.screenshot({ path: `${SHOT_DIR}/1-audio.png` })

  markStage("database")
  await openPluginPage(page, "/home")
  await deleteDb(page, "ideall:database")
  await openPluginPage(page, "/database")
  await page.getByRole("heading", { name: "数据库", exact: true }).waitFor({
    state: "visible",
    timeout: 30000,
  })
  await page.getByPlaceholder("table name").fill(TABLE_NAME)
  await page.getByPlaceholder("columns").fill("name, value")
  await page.getByRole("button", { name: "创建", exact: true }).click()
  await page.getByRole("button", { name: TABLE_NAME, exact: false }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  await page.locator('label:has-text("name") input').fill("alpha")
  await page.locator('label:has-text("value") input').fill("42")
  await page.getByRole("button", { name: "写入", exact: true }).click()
  await page.getByText("alpha", { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  await page.getByText("42", { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  record("数据库插件可建表并写入行", true)
  const dbDownloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出全部", exact: true }).click()
  const dbDownload = await dbDownloadPromise
  const dbExportPath = await dbDownload.path()
  if (!dbExportPath) throw new Error("database JSON export path unavailable")
  record("数据库插件可导出 JSON 备份", true)
  await page.getByRole("button", { name: "删除表", exact: true }).click()
  await page.getByText("创建或选择一张表", { exact: true }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  record("数据库插件可删除表并清理行", true)
  await page
    .locator('input[type="file"][accept="application/json,.json"]')
    .setInputFiles(dbExportPath)
  await page.getByRole("button", { name: TABLE_NAME, exact: false }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  await page.getByText("alpha", { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  record("数据库插件可从 JSON 备份恢复", true)
  await page.screenshot({ path: `${SHOT_DIR}/2-database.png` })

  markStage("code")
  await openPluginPage(page, "/code")
  await page.evaluate((secret) => localStorage.setItem("ideall-smoke-token", secret), SECRET_TOKEN)
  await seedLegacySecurityData(page)
  await page.getByRole("button", { name: "刷新", exact: true }).click()
  await page.getByText("ideall-smoke-token", { exact: true }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  const codeText = (await page.locator("body").textContent()) ?? ""
  record(
    "Code 插件展示诊断且敏感存储脱敏",
    codeText.includes("已脱敏") &&
      !codeText.includes(SECRET_TOKEN) &&
      !codeText.includes(LEGACY_AUTH_TOKEN) &&
      !codeText.includes(LEGACY_SYNC_CODE) &&
      !codeText.includes(LEGACY_AGENT_KEY) &&
      !codeText.includes(LEGACY_MCP_SECRET) &&
      !codeText.includes(LEGACY_WORKSPACE_KEY),
  )
  record(
    "Code 插件展示插件数据端口",
    codeText.includes("ideall.audio.library") &&
      codeText.includes("ideall.database.workspace") &&
      codeText.includes("ideall.git.repos") &&
      codeText.includes("ideall.agent.config") &&
      codeText.includes("ideall.sync.status"),
  )
  record(
    "Code 插件展示安全存储诊断",
    codeText.includes("安全存储") && codeText.includes("迁移/清理敏感值"),
  )
  const legacySecurity = await readSecurityMigrationState(page)
  record(
    "Code 插件可识别旧敏感存储",
    (legacySecurity.legacyAuthToken === LEGACY_AUTH_TOKEN ||
      legacySecurity.fallbackAuthToken === LEGACY_AUTH_TOKEN) &&
      (legacySecurity.legacySyncCode === LEGACY_SYNC_CODE ||
        legacySecurity.fallbackSyncCode === LEGACY_SYNC_CODE) &&
      (legacySecurity.publicAgentApiKey === LEGACY_AGENT_KEY ||
        legacySecurity.fallbackAgentKey === LEGACY_AGENT_KEY) &&
      (legacySecurity.publicSecretValue === LEGACY_MCP_SECRET ||
        legacySecurity.fallbackSecret === LEGACY_MCP_SECRET) &&
      (legacySecurity.publicWorkspaceDump.includes(LEGACY_WORKSPACE_KEY) ||
        legacySecurity.fallbackWorkspaceKey === LEGACY_WORKSPACE_KEY),
  )
  await page.getByRole("button", { name: "迁移/清理敏感值", exact: true }).click()
  await page.waitForFunction(
    ({ authToken, syncCode, agentKey, secret, workspaceKey, workspaceFallbackKey }) =>
      localStorage.getItem("wonita:auth:token") === null &&
      localStorage.getItem("wonita:sync:code") === null &&
      localStorage.getItem("ideall:secure-fallback:ideall:auth:token") === authToken &&
      localStorage.getItem("ideall:secure-fallback:ideall:sync:code") === syncCode &&
      localStorage.getItem("ideall:secure-fallback:ideall:agent:settings:apiKey") === agentKey &&
      localStorage.getItem("ideall:secure-fallback:ideall:agent:secret:SMOKE_SECRET") === secret &&
      localStorage.getItem(workspaceFallbackKey) === workspaceKey,
    {
      authToken: LEGACY_AUTH_TOKEN,
      syncCode: LEGACY_SYNC_CODE,
      agentKey: LEGACY_AGENT_KEY,
      secret: LEGACY_MCP_SECRET,
      workspaceKey: LEGACY_WORKSPACE_KEY,
      workspaceFallbackKey: `ideall:secure-fallback:ideall:agent:workspace:${LEGACY_WORKSPACE_ID}:apiKey`,
    },
    { timeout: 15000 },
  )
  const migratedSecurity = await readSecurityMigrationState(page)
  record(
    "Code 插件可迁移旧敏感存储到 secure-store",
    migratedSecurity.legacyAuthToken === null &&
      migratedSecurity.legacySyncCode === null &&
      migratedSecurity.fallbackAuthToken === LEGACY_AUTH_TOKEN &&
      migratedSecurity.fallbackSyncCode === LEGACY_SYNC_CODE &&
      migratedSecurity.fallbackAgentKey === LEGACY_AGENT_KEY &&
      migratedSecurity.fallbackSecret === LEGACY_MCP_SECRET &&
      migratedSecurity.fallbackWorkspaceKey === LEGACY_WORKSPACE_KEY &&
      migratedSecurity.publicAgentApiKey === undefined &&
      migratedSecurity.publicSecretValue === "" &&
      !migratedSecurity.publicWorkspaceDump.includes(LEGACY_WORKSPACE_KEY),
  )
  record(
    "Code 插件展示导入入口和数据 Schema",
    codeText.includes("导入") &&
      codeText.includes("数据 Schema") &&
      codeText.includes("Git 仓库列表"),
  )
  await page
    .locator('input[type="file"][accept="application/json,.json"]')
    .last()
    .setInputFiles({
      name: `ideall-git-code-import-${RUN_ID}.json`,
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          kind: "ideall.plugin-data",
          version: 1,
          plugin: {
            id: "git",
            label: "Git",
            dataKind: "ideall.git.repos",
            dataVersion: 1,
          },
          exportedAt: new Date(RUN_ID).toISOString(),
          payload: { repos: [CODE_IMPORT_REPO] },
        }),
      ),
    })
  await page.getByText("导入会替换 Git 插件保存的仓库路径列表。", { exact: true }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  await page.getByRole("button", { name: "执行导入", exact: true }).click()
  await page.getByText("导入前备份已创建", { exact: true }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  const importedRepos = await page.evaluate((key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "[]")
    } catch {
      return []
    }
  }, GIT_REPOS_KEY)
  record(
    "Code 插件可预检并导入插件数据",
    Array.isArray(importedRepos) && importedRepos.includes(CODE_IMPORT_REPO),
  )
  await page.getByRole("button", { name: "恢复导入前备份", exact: true }).click()
  await page.waitForFunction((key) => localStorage.getItem(key) === "[]", GIT_REPOS_KEY)
  record("Code 插件可恢复导入前备份", true)
  await page.screenshot({ path: `${SHOT_DIR}/3-code.png` })

  markStage("git")
  await openPluginPage(page, "/git")
  await page.getByText("Git 工作台仅在桌面 App 中可用", { exact: true }).waitFor({
    state: "visible",
    timeout: 30000,
  })
  record("Git 插件在浏览器形态显示桌面 App 限定兜底", true)
  await page.screenshot({ path: `${SHOT_DIR}/4-git.png` })

  recordNoPageErrors(pageErrors, record, {
    ignoreFetchAfterConnectionClosed: true,
    ignoreConsoleFetchFailures: true,
  })
} catch (e) {
  record("插件冒烟脚本异常", false, String(e.message).split("\n")[0])
  await page.screenshot({ path: `${SHOT_DIR}/error.png` }).catch(() => {})
} finally {
  try {
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
  } catch (e) {
    console.log(`cleanup skipped: ${String(e.message).split("\n")[0]}`)
  }
  await run.close()
}

run.finish("{1-audio,2-database,3-code,4-git,error}.png")
