// 桌面自动更新 (Tauri updater 插件)。移动端走应用商店, 此处仅桌面 (Tauri) 生效。
//
// 启用前提 (见 docs/app.md «Phase 3»):
//   1. `pnpm tauri signer generate` 生成更新签名密钥对;
//   2. 把公钥填进 tauri.conf.json 的 plugins.updater.pubkey, 配 endpoints (托管 latest.json);
//   3. CI 用私钥 TAURI_SIGNING_PRIVATE_KEY(+ _PASSWORD) 签名发布产物。
// 未配置 endpoints 时本函数安静降级 (返回 false), 不影响使用。

/** 是否在 Tauri (App) 环境。 */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/**
 * 检查并安装桌面更新。无更新 / 未配置 endpoints / 非 Tauri 时安静返回 false。
 * 返回 true 表示已下载并安装新版本 (通常需调用方提示重启生效)。
 * 供「检查更新」按钮或启动时调用 (本仓库默认不自动调用, 由 UI 决定时机)。
 */
export async function checkForUpdate(): Promise<boolean> {
  if (!inTauri()) return false
  try {
    const { check } = await import("@tauri-apps/plugin-updater")
    const update = await check()
    if (!update) return false
    await update.downloadAndInstall()
    return true
  } catch (e) {
    // 未配置 endpoints / 网络失败 / 签名校验失败等: 安静降级, 不打断使用。
    console.warn("[updater] 检查更新未完成:", e)
    return false
  }
}
