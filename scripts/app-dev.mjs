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

// 系统 PATH 里是否有某个可执行文件 (用于探测已装的输入法框架)。
function has(bin) {
  return spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0
}

const env = { ...process.env }
if (process.platform === "linux") {
  env.WEBKIT_DISABLE_DMABUF_RENDERER ??= "1"
  env.WEBKIT_DISABLE_COMPOSITING_MODE ??= "1"
  // 注: 内嵌浏览器子 webview (Window::add_child) 仅 X11; 但 WSLg 下 GDK_BACKEND=x11 会让 XWayland
  // 不显示鼠标光标, 故不默认设置 (优先保 app 可用)。需在 WSLg 调内嵌浏览器时手动 `GDK_BACKEND=x11 pnpm app:dev`。
  // 输入法 (IME): WebKitGTK 经 GTK IM module 连接 fcitx/ibus 才能输入中日韩文。
  // WSL2/WSLg 默认不带输入法; 装好框架后这些变量须在 WebProcess *启动前* 就位 (同上面的渲染开关,
  // 进程内 set_var 传不到 WebProcess)。仅在系统确实装了对应框架、且用户未显式指定时自动注入,
  // 不硬塞 (避免指向不存在的 module 反而更糟)。装了 fcitx 优先 fcitx, 否则 ibus。
  const ime = has("fcitx5") || has("fcitx") ? "fcitx" : has("ibus") ? "ibus" : null
  if (ime) {
    env.GTK_IM_MODULE ??= ime
    env.QT_IM_MODULE ??= ime
    env.XMODIFIERS ??= `@im=${ime}`
  }
}

const isWin = process.platform === "win32"
const result = spawnSync(isWin ? "tauri.cmd" : "tauri", ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  shell: isWin,
})
process.exit(result.status ?? 0)
