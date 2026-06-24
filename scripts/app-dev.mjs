// 启动 Tauri 桌面开发壳, 并在应用进程「启动前」注入 WebKitGTK 软件渲染开关。
//
// 背景: WSL2 / 无独立 GPU 的 Linux 下, WebKitGTK 的 DMABUF / 加速合成渲染会初始化失败
//   (libEGL / MESA ZINK / dri2 报错), 导致 dev 窗口空白。这两个变量必须在应用进程 *启动前*
//   就位 —— 进程内 std::env::set_var 传不到 WebKitGTK 的 WebProcess (实测无效), 故在此 wrapper
//   里注入, 免去每次手敲 `WEBKIT_...=1 pnpm app:dev`。仅 Linux 注入; 已显式设置则尊重原值。
//
// 用法:
//   pnpm app:dev                                   # 默认 5020
//   pnpm app:dev --config '{"build":{"devUrl":"http://localhost:5026","beforeDevCommand":"pnpm exec next dev -p 5026"}}'
//   —— 末尾的参数原样透传给 `tauri dev` (如 5020 被占用时用 --config 换端口, 见 docs/app.md)。
import { spawnSync } from "node:child_process"

const env = { ...process.env }
if (process.platform === "linux") {
  env.WEBKIT_DISABLE_DMABUF_RENDERER ??= "1"
  env.WEBKIT_DISABLE_COMPOSITING_MODE ??= "1"
}

const isWin = process.platform === "win32"
const result = spawnSync(isWin ? "tauri.cmd" : "tauri", ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  shell: isWin,
})
process.exit(result.status ?? 0)
