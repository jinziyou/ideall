// 启动 Tauri 桌面开发壳, 并在应用进程「启动前」注入 WebKitGTK 软件渲染开关。
//
// 背景: WSL2 / 无独立 GPU 的 Linux 下, WebKitGTK 的 DMABUF / 加速合成渲染会初始化失败
//   (libEGL / MESA ZINK / dri2 报错), 导致 dev 窗口空白。这两个变量必须在应用进程 *启动前*
//   就位 —— 进程内 std::env::set_var 传不到 WebKitGTK 的 WebProcess (实测无效), 故在此 wrapper
//   里注入, 免去每次手敲 `WEBKIT_...=1 pnpm app:dev`。仅 Linux 注入; 已显式设置则尊重原值。
//
// 另: Tauri 的 dev-server 探测只认端口可连, 不会等 Next 首屏编译完成; WSL 下 Turbopack 首编译
//   `/` 可能要数分钟, 窗口会先空白。本脚本先起 (或复用) Next, 预热 `/` 后再 `--no-dev-server-wait`
//   启动 Tauri, 避免长时间白屏。
//
// 用法:
//   pnpm app:dev                                   # 默认 5020
//   pnpm app:dev --config '{"build":{"devUrl":"http://localhost:5026","beforeDevCommand":"pnpm exec next dev -p 5026"}}'
//   —— 末尾的参数原样透传给 `tauri dev` (如 5020 被占用时用 --config 换端口, 见 docs/app.md)。
//
import { spawn, spawnSync } from "node:child_process"
import http from "node:http"
import net from "node:net"
import path from "node:path"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function has(bin) {
  return spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0
}

function parseDevUrl(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--config" || !argv[i + 1]) continue
    try {
      const cfg = JSON.parse(argv[i + 1])
      if (cfg.build?.devUrl) return cfg.build.devUrl
    } catch {
      // 文件路径形式的 --config 仍走默认 devUrl
    }
  }
  // 必须用 localhost, 勿用 127.0.0.1: Next.js 16 dev (Turbopack) 对后者会拦 dev 资源 / HMR,
  // React 无法水合 → Tauri 窗口「能看不能点」(Playwright 127.0.0.1 复现, localhost 正常)。
  return "http://localhost:5020"
}

function portTaken(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once("error", () => resolve(true))
    srv.once("listening", () => srv.close(() => resolve(false)))
    srv.listen(port, "127.0.0.1")
  })
}

async function waitForTcp(port, maxMs = 180_000) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const s = net.connect(port, "127.0.0.1", () => {
          s.destroy()
          resolve()
        })
        s.on("error", reject)
        s.setTimeout(2000, () => {
          s.destroy()
          reject(new Error("timeout"))
        })
      })
      return
    } catch {
      await sleep(500)
    }
  }
  throw new Error(`Timed out waiting for Next.js on port ${port}`)
}

function request(url, { method = "GET", timeoutMs = 900_000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, timeout: timeoutMs }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on("error", reject)
    req.on("timeout", () => {
      req.destroy()
      reject(new Error(`${method} ${url} timed out`))
    })
    req.end()
  })
}

async function warmupHome(url) {
  const start = Date.now()
  console.log(`\n[app:dev] Pre-compiling ${url} (WSL 首启可能要数分钟, 请稍候)…\n`)
  const status = await request(url)
  if (status < 200 || status >= 500) {
    throw new Error(`Warmup got HTTP ${status}`)
  }
  const sec = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\n[app:dev] Frontend ready (${sec}s). Launching Tauri…\n`)
}

const env = { ...process.env }
if (process.platform === "linux") {
  env.WEBKIT_DISABLE_DMABUF_RENDERER ??= "1"
  env.WEBKIT_DISABLE_COMPOSITING_MODE ??= "1"
  // WSLg: 抑制 AT-SPI / dconf 启动噪音。
  env.NO_AT_BRIDGE ??= "1"
  env.GTK_A11Y ??= "none"
  env.GSETTINGS_BACKEND ??= "memory"
  // 无 DRI3 的 WSLg X11 下抑制 libEGL/MESA 噪音 (与 WebKit 软件渲染一致)。
  env.LIBGL_ALWAYS_SOFTWARE ??= "1"
  // WSLg 多屏窗口定位需 X11; IDEALL_GDK_X11=0 退回 Wayland (坐标不可控)。
  if (env.IDEALL_GDK_X11 !== "0") {
    env.GDK_BACKEND ??= "x11"
  }
  const ime = has("fcitx5") || has("fcitx") ? "fcitx" : has("ibus") ? "ibus" : null
  if (ime) {
    env.GTK_IM_MODULE ??= ime
    env.QT_IM_MODULE ??= ime
    env.XMODIFIERS ??= `@im=${ime}`
  }
}

const isWin = process.platform === "win32"
const userArgs = process.argv.slice(2)
const devUrl = parseDevUrl(userArgs)
const homeUrl = devUrl.endsWith("/") ? devUrl : `${devUrl}/`
const port = Number(new URL(devUrl).port || 5020)

let nextChild = null
function cleanup() {
  if (nextChild && !nextChild.killed) nextChild.kill("SIGTERM")
}
process.on("SIGINT", () => {
  cleanup()
  process.exit(130)
})
process.on("SIGTERM", () => {
  cleanup()
  process.exit(143)
})

async function main() {
  const alreadyUp = await portTaken(port)
  if (!alreadyUp) {
    const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next")
    nextChild = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
      stdio: "inherit",
      env,
    })
    nextChild.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        cleanup()
        process.exit(code)
      }
    })
    await waitForTcp(port)
  } else {
    console.log(`[app:dev] Port ${port} already in use — reusing existing dev server.`)
  }

  let warm = true
  try {
    const status = await request(homeUrl, { method: "HEAD", timeoutMs: 10_000 })
    warm = status < 200 || status >= 300
  } catch {
    warm = true
  }
  if (warm) await warmupHome(homeUrl)
  else console.log("[app:dev] Frontend already warm. Launching Tauri…")

  // Next.js dev (Turbopack) 依赖 eval + dev WebSocket; 生产 CSP 缺 unsafe-eval → SSR 壳能画出来但
  // React 无法水合, 表现为整窗点击无响应。仅 app:dev 注入放宽 CSP, 打包仍走 tauri.conf.json。
  const devCsp =
    "default-src 'self' tauri:; script-src 'self' tauri: 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; font-src 'self' data:; connect-src 'self' tauri: ws: wss: http://127.0.0.1:* http://localhost:*; frame-src 'self' tauri: https://www.wonita.link https://wonita.link https://stately.ai; worker-src 'self' blob:"
  const tauriConfig = JSON.stringify({
    build: { beforeDevCommand: "", devUrl },
    app: { security: { csp: devCsp } },
  })
  const tauriJs = path.join(process.cwd(), "node_modules", "@tauri-apps", "cli", "tauri.js")
  const result = spawnSync(
    process.execPath,
    [tauriJs, "dev", "--no-dev-server-wait", ...userArgs, "--config", tauriConfig],
    { stdio: "inherit", env },
  )
  cleanup()
  process.exit(result.status ?? 1)
}

main().catch((err) => {
  console.error("[app:dev]", err.message)
  cleanup()
  process.exit(1)
})
