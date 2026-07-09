import { readFile } from "node:fs/promises"
import {
  CODE_IMPORT_REPO,
  GIT_REPOS_KEY,
  LEGACY_AGENT_KEY,
  LEGACY_AUTH_TOKEN,
  LEGACY_MCP_SECRET,
  LEGACY_SYNC_CODE,
  LEGACY_WORKSPACE_ID,
  LEGACY_WORKSPACE_KEY,
  RUN_ID,
  SECRET_TOKEN,
  SHOT_DIR,
  openPluginPage,
  readSecurityMigrationState,
  seedLegacySecurityData,
} from "./shared.mjs"

export async function runCodePluginSmoke({ page, record, markStage }) {
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
  await openPluginPage(page, "/code")
  await page.getByRole("button", { name: "导出全部", exact: true }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  const workspaceDownloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出全部", exact: true }).click()
  const workspaceDownload = await workspaceDownloadPromise
  const workspaceExportPath = await workspaceDownload.path()
  if (!workspaceExportPath) throw new Error("workspace backup export path unavailable")
  const workspaceBackup = JSON.parse(await readFile(workspaceExportPath, "utf8"))
  record(
    "Code 插件可导出全量插件备份",
    workspaceBackup.kind === "ideall.workspace-backup" &&
      Array.isArray(workspaceBackup.plugins) &&
      workspaceBackup.plugins.some((plugin) => plugin?.plugin?.id === "git"),
  )
  await page.evaluate((key) => localStorage.setItem(key, "[]"), GIT_REPOS_KEY)
  await page
    .locator('input[type="file"][accept="application/json,.json"]')
    .last()
    .setInputFiles(workspaceExportPath)
  await page.getByText("ideall.workspace-backup", { exact: false }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  await page.getByRole("button", { name: "执行导入", exact: true }).click()
  await page.waitForFunction(
    ({ key, repo }) => {
      try {
        return JSON.parse(localStorage.getItem(key) || "[]").includes(repo)
      } catch {
        return false
      }
    },
    { key: GIT_REPOS_KEY, repo: CODE_IMPORT_REPO },
    { timeout: 15000 },
  )
  record("Code 插件可导入全量插件备份", true)
  await page.getByRole("button", { name: "恢复导入前备份", exact: true }).click()
  await page.waitForFunction((key) => localStorage.getItem(key) === "[]", GIT_REPOS_KEY)
  record("Code 插件可恢复导入前备份", true)

  await page.evaluate(({ key, repo }) => localStorage.setItem(key, JSON.stringify([repo])), {
    key: GIT_REPOS_KEY,
    repo: CODE_IMPORT_REPO,
  })
  const archiveDownloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "归档", exact: true }).click()
  const archiveDownload = await archiveDownloadPromise
  const archiveExportPath = await archiveDownload.path()
  if (!archiveExportPath) throw new Error("workspace archive export path unavailable")
  const workspaceArchive = JSON.parse(await readFile(archiveExportPath, "utf8"))
  record(
    "Code 插件可导出完整工作区归档",
    workspaceArchive.kind === "ideall.workspace-archive" &&
      Array.isArray(workspaceArchive.core?.nodes) &&
      Array.isArray(workspaceArchive.core?.blobs) &&
      Array.isArray(workspaceArchive.core?.trashSnapshots) &&
      workspaceArchive.plugins?.kind === "ideall.workspace-backup",
  )
  await page.evaluate((key) => localStorage.setItem(key, "[]"), GIT_REPOS_KEY)
  await page
    .locator('input[type="file"][accept="application/json,.json"]')
    .last()
    .setInputFiles(archiveExportPath)
  await page.getByText("ideall.workspace-archive", { exact: false }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  await page.getByRole("button", { name: "执行导入", exact: true }).click()
  await page.waitForFunction(
    ({ key, repo }) => {
      try {
        return JSON.parse(localStorage.getItem(key) || "[]").includes(repo)
      } catch {
        return false
      }
    },
    { key: GIT_REPOS_KEY, repo: CODE_IMPORT_REPO },
    { timeout: 15000 },
  )
  record("Code 插件可导入完整工作区归档", true)
  await page.getByRole("button", { name: "恢复导入前备份", exact: true }).click()
  await page.waitForFunction((key) => localStorage.getItem(key) === "[]", GIT_REPOS_KEY)
  record("Code 插件可恢复完整工作区归档备份", true)
  await page.screenshot({ path: `${SHOT_DIR}/3-code.png` })
}
