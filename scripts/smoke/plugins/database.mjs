import { SHOT_DIR, TABLE_NAME, deleteDb, openPluginPage, openPluginSurface } from "./shared.mjs"

export async function runDatabasePluginSmoke({ page, record, markStage }) {
  markStage("database")
  await openPluginPage(page, "/home")
  await deleteDb(page, "ideall:database")
  await openPluginSurface(page, "database")
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
}
