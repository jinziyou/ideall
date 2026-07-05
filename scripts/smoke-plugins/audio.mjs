import { BASE, createSilentWavBuffer } from "../smoke-lib.mjs"
import { AUDIO_TITLE, SHOT_DIR, deleteDb, openPluginPage, resetWorkspace } from "./shared.mjs"

export async function runAudioPluginSmoke({ page, record, markStage }) {
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
}
