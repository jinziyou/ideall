// Plugin core smoke test (Playwright) against the real browser UI.
//
// Usage: pnpm smoke:plugins
// Optional: BASE=http://localhost:<port> pnpm smoke:plugins
// Screenshots: /tmp/plugins-smoke/*.png
import { BASE, createSmokeRun, recordNoPageErrors } from "./smoke-lib.mjs"
import { runAudioPluginSmoke } from "./smoke-plugins/audio.mjs"
import { runCodePluginSmoke } from "./smoke-plugins/code.mjs"
import { runDatabasePluginSmoke } from "./smoke-plugins/database.mjs"
import { runGitPluginSmoke } from "./smoke-plugins/git.mjs"
import { SHOT_DIR, WORKSPACE_KEY, cleanupPluginSmokeData } from "./smoke-plugins/shared.mjs"

const run = await createSmokeRun({ shotDir: SHOT_DIR })
const { page, pageErrors, record } = run

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

  await runAudioPluginSmoke(run)
  await runDatabasePluginSmoke(run)
  await runCodePluginSmoke(run)
  await runGitPluginSmoke(run)

  recordNoPageErrors(pageErrors, record, {
    ignoreFetchAfterConnectionClosed: true,
    ignoreConsoleFetchFailures: true,
  })
} catch (e) {
  record("插件冒烟脚本异常", false, String(e.message).split("\n")[0])
  await page.screenshot({ path: `${SHOT_DIR}/error.png` }).catch(() => {})
} finally {
  try {
    await cleanupPluginSmokeData(page)
  } catch (e) {
    console.log(`cleanup skipped: ${String(e.message).split("\n")[0]}`)
  }
  await run.close()
}

run.finish("{1-audio,2-database,3-code,4-git,error}.png")
