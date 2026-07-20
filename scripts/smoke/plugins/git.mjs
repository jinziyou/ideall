import { SHOT_DIR, openPluginSurface } from "./shared.mjs"

export async function runGitPluginSmoke({ page, record, markStage }) {
  markStage("git")
  await openPluginSurface(page, "git")
  await page.getByText("Git 工作台仅在桌面 App 中可用", { exact: true }).waitFor({
    state: "visible",
    timeout: 30000,
  })
  record("Git 插件在浏览器形态显示桌面 App 限定兜底", true)
  await page.screenshot({ path: `${SHOT_DIR}/4-git.png` })
}
