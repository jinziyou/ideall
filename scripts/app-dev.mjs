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
// WSL + Clash fake-ip: Windows TUN 下浏览器正常, WSL 解析 198.18.x 直连超时。
// 优先: Windows Clash 开 allow-lan + mixed-port → HTTP 代理 (IDEALL_PROXY_PORT, 默认 7890)。
// 仅 TUN、无代理口: 运行 pnpm wsl:hosts --apply 写 /etc/hosts 真实 IP (与 TUN 并存)。
// IDEALL_WSL_PROXY=0 跳过代理探测; 代理口不通时不注入无效 HTTP_PROXY。
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import net from "node:net"

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

/** WSL2: /etc/resolv.conf 的 nameserver 即 Windows 宿主 IP (Clash Allow LAN 监听在此)。 */
function wslWindowsHostIp() {
  try {
    const ver = fs.readFileSync("/proc/version", "utf8")
    if (!/microsoft/i.test(ver)) return null
    const resolv = fs.readFileSync("/etc/resolv.conf", "utf8")
    const m = resolv.match(/^nameserver\s+(\S+)/m)
    return m?.[1] ?? null
  } catch {
    return null
  }
}

function proxyReachable(host, port, ms = 2000) {
  return new Promise((resolve) => {
    const s = net.connect(Number(port), host, () => {
      s.destroy()
      resolve(true)
    })
    s.on("error", () => resolve(false))
    s.setTimeout(ms, () => {
      s.destroy()
      resolve(false)
    })
  })
}

function isFakeIp(ip) {
  if (!ip) return false
  const p = ip.split(".").map(Number)
  return p.length === 4 && p[0] === 198 && p[1] >= 18 && p[1] <= 19
}

function systemResolve(name) {
  const r = spawnSync("getent", ["hosts", name], { encoding: "utf8" })
  const m = r.stdout.trim().match(/^(\S+)/)
  return m?.[1] ?? null
}

/** 方案 B: 仅当 Windows Clash HTTP 口可达时注入代理 (纯 TUN 无 mixed-port 则跳过)。 */
async function applyWslClashProxy(env) {
  if (process.platform !== "linux") return false
  if (process.env.IDEALL_WSL_PROXY === "0") return false
  if (env.HTTP_PROXY || env.http_proxy || env.HTTPS_PROXY || env.https_proxy) return true

  const host = wslWindowsHostIp()
  if (!host) return false

  const port = env.IDEALL_PROXY_PORT ?? "7890"
  const ok = await proxyReachable(host, port)
  if (!ok) return false

  const proxy = `http://${host}:${port}`
  const noProxy = env.NO_PROXY ?? env.no_proxy ?? "localhost,127.0.0.1,::1,10.0.0.0/8"

  env.HTTP_PROXY = proxy
  env.HTTPS_PROXY = proxy
  env.http_proxy = proxy
  env.https_proxy = proxy
  env.NO_PROXY = noProxy
  env.no_proxy = noProxy
  console.log(`[app:dev] WSL proxy → ${proxy}`)
  return true
}

/** Clash 纯 TUN: 提示 fake-ip + hosts 修复 (不依赖 7890)。 */
function warnWslTunFakeIp() {
  if (process.platform !== "linux" || !wslWindowsHostIp()) return
  const ip = systemResolve("www.wonita.link")
  if (!isFakeIp(ip)) return
  console.warn(
    `[app:dev] Clash TUN fake-ip: www.wonita.link → ${ip} (WSL 不可达)\n` +
      "  · 纯 TUN 无 HTTP 代理口 → 请运行: sudo node scripts/wsl-wonita-hosts.mjs --apply\n" +
      "  · 或在 Clash 额外开启 mixed-port + allow-lan (可与 TUN 并存)\n" +
      "  · IDEALL_WSL_PROXY=0 跳过代理探测",
  )
}

const env = { ...process.env }
if (process.platform === "linux") {
  env.WEBKIT_DISABLE_DMABUF_RENDERER ??= "1"
  env.WEBKIT_DISABLE_COMPOSITING_MODE ??= "1"
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
  const proxied = await applyWslClashProxy(env)
  if (!proxied) warnWslTunFakeIp()

  const alreadyUp = await portTaken(port)
  if (!alreadyUp) {
    const nextArgs = port === 5020 ? ["dev"] : ["exec", "next", "dev", "-p", String(port)]
    nextChild = spawn("pnpm", nextArgs, { stdio: "inherit", env, shell: isWin })
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
    "default-src 'self' tauri:; script-src 'self' tauri: 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; font-src 'self' data:; connect-src 'self' tauri: ws: wss: http://127.0.0.1:* http://localhost:*; frame-src 'self' https://www.wonita.link https://wonita.link; worker-src 'self' blob:"
  const tauriConfig = JSON.stringify({
    build: { beforeDevCommand: "", devUrl },
    app: { security: { csp: devCsp } },
  })
  const result = spawnSync(
    isWin ? "tauri.cmd" : "tauri",
    ["dev", "--no-dev-server-wait", ...userArgs, "--config", tauriConfig],
    { stdio: "inherit", env, shell: isWin },
  )
  cleanup()
  process.exit(result.status ?? 1)
}

main().catch((err) => {
  console.error("[app:dev]", err.message)
  cleanup()
  process.exit(1)
})
