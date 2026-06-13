// 桌面自动更新 (Tauri updater 插件)。移动端走应用商店, 此处仅桌面 (Tauri) 生效。
//
// 启用前提 (见 docs/app.md «Phase 3»):
//   1. `pnpm tauri signer generate` 生成更新签名密钥对;
//   2. 把公钥填进 tauri.conf.json 的 plugins.updater.pubkey, 配 endpoints (托管 latest.json);
//   3. CI 用私钥 TAURI_SIGNING_PRIVATE_KEY(+ _PASSWORD) 签名发布产物。
// 未配置 endpoints 时返回 "error" (安静降级), 不影响使用。

/** 是否在 Tauri (App) 环境。 */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/** 检查更新结果: 已下载安装 / 已是最新 / 非桌面环境 / 检查失败 (含未配置 endpoints)。 */
export type UpdateCheckResult = "updated" | "uptodate" | "unsupported" | "error"

/**
 * 检查并安装桌面更新。仅 Tauri 桌面生效。
 * - `"updated"`：已下载并安装新版本（通常需调用方提示重启生效）。
 * - `"uptodate"`：已是最新，无更新。
 * - `"unsupported"`：非 Tauri 桌面环境（web / 移动）。
 * - `"error"`：检查失败（未配置 endpoints / 网络 / 签名校验失败等），已安静记录。
 * 供「检查更新」入口调用（本仓库默认不自动调用，由 UI 决定时机）。
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!inTauri()) return "unsupported"
  try {
    const { check } = await import("@tauri-apps/plugin-updater")
    const update = await check()
    if (!update) return "uptodate"
    await update.downloadAndInstall()
    return "updated"
  } catch (e) {
    console.warn("[updater] 检查更新未完成:", e)
    return "error"
  }
}
