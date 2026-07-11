// 启动 Tauri 桌面开发壳，并在应用进程启动前注入 Linux/WSL WebKitGTK 软件渲染开关。
// wrapper 只管理自己启动的 Next/Tauri 进程组；检测到外部 Next 时只复用，退出时绝不终止它。
import { spawnSync } from "node:child_process"
import http from "node:http"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  installShutdownHandlers,
  spawnDetached,
  stopChildProcess,
  waitForChildExit,
} from "./script-utils.mjs"

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const DEFAULT_DEV_URL = "http://localhost:5020"
const APP_DEV_HELP = `用法:
  pnpm app:dev
  pnpm app:dev --config '{"build":{"devUrl":"http://localhost:5026"}}'
  pnpm app:dev -- [runnerArgs] -- [appArgs]

说明:
  复用或启动 Next 开发服，预热首页后启动 Tauri。末尾参数透传给 tauri dev。
  wrapper 识别 tauri dev 的标准选项；未知选项会在启动任何子进程前失败。

常用选项:
  -c, --config <json|path>  覆盖 Tauri 配置；JSON 中的 build.devUrl 同时控制 Next 端口
  -f, --features <list>     Cargo feature（多项请使用逗号分隔）
  -t, --target <target>     Rust target triple
      --release             release 模式运行
      --no-watch            禁用 Rust 文件监听
  -h, --help                显示本帮助且不启动服务
  -V, --version             显示 Tauri CLI 版本且不启动服务
`

const OPTIONS_WITH_VALUE = new Set([
  "-r",
  "--runner",
  "-t",
  "--target",
  "-f",
  "--features",
  "-c",
  "--config",
  "--additional-watch-folders",
  "--port",
])
const FLAG_OPTIONS = new Set([
  "-e",
  "--exit-on-panic",
  "--release",
  "--no-dev-server-wait",
  "--no-watch",
  "--no-dev-server",
  "--verbose",
])

export function parseAppDevArgs(argv) {
  const result = { help: false, version: false, userArgs: [] }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === "--help" || argument === "-h") {
      result.help = true
      continue
    }
    if (argument === "--version" || argument === "-V") {
      result.version = true
      continue
    }
    if (argument === "--") {
      result.userArgs.push(...argv.slice(index))
      break
    }

    const equalsIndex = argument.startsWith("--") ? argument.indexOf("=") : -1
    const optionName = equalsIndex > 0 ? argument.slice(0, equalsIndex) : argument
    if (OPTIONS_WITH_VALUE.has(optionName)) {
      result.userArgs.push(argument)
      if (equalsIndex < 0) {
        const value = argv[++index]
        if (value === undefined || value === "--") throw new Error(`${optionName} 缺少参数`)
        result.userArgs.push(value)
      } else if (equalsIndex === argument.length - 1) {
        throw new Error(`${optionName} 缺少参数`)
      }
      continue
    }
    if (FLAG_OPTIONS.has(optionName) || /^-v+$/.test(argument)) {
      result.userArgs.push(argument)
      continue
    }
    if (argument.startsWith("-")) throw new Error(`未知选项: ${argument}`)
    result.userArgs.push(argument)
  }
  return result
}

function has(bin) {
  return spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0
}

function parseDevUrl(argv) {
  let devUrl = DEFAULT_DEV_URL
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    let rawConfig = null
    if ((argument === "--config" || argument === "-c") && argv[index + 1]) rawConfig = argv[++index]
    else if (argument.startsWith("--config=")) rawConfig = argument.slice("--config=".length)
    if (!rawConfig) continue
    try {
      const config = JSON.parse(rawConfig)
      if (typeof config.build?.devUrl === "string") devUrl = config.build.devUrl
    } catch {
      // 文件路径或 JSON5/TOML 仍交给 Tauri 解析；wrapper 无法静态读取时沿用默认 devUrl。
    }
  }
  const parsed = new URL(devUrl)
  if (parsed.protocol !== "http:" || parsed.hostname !== "localhost") {
    throw new Error(`build.devUrl 必须使用 http://localhost:<port>: ${devUrl}`)
  }
  return parsed.toString().replace(/\/$/, "")
}

function createAppEnvironment() {
  const env = { ...process.env }
  if (process.platform !== "linux") return env
  env.WEBKIT_DISABLE_DMABUF_RENDERER ??= "1"
  env.WEBKIT_DISABLE_COMPOSITING_MODE ??= "1"
  env.NO_AT_BRIDGE ??= "1"
  env.GTK_A11Y ??= "none"
  env.GSETTINGS_BACKEND ??= "memory"
  env.LIBGL_ALWAYS_SOFTWARE ??= "1"
  if (env.IDEALL_GDK_X11 !== "0") env.GDK_BACKEND ??= "x11"
  const ime = has("fcitx5") || has("fcitx") ? "fcitx" : has("ibus") ? "ibus" : null
  if (ime) {
    env.GTK_IM_MODULE ??= ime
    env.QT_IM_MODULE ??= ime
    env.XMODIFIERS ??= `@im=${ime}`
  }
  return env
}

function portTaken(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(true))
    server.once("listening", () => server.close(() => resolve(false)))
    server.listen(port, "127.0.0.1")
  })
}

async function waitForTcp(port, child, maxMs = 180_000) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (child && (child.exitCode != null || child.signalCode != null)) {
      throw new Error(`Next.js 在端口就绪前退出 (${child.signalCode ?? child.exitCode})`)
    }
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1", () => {
          socket.destroy()
          resolve()
        })
        socket.on("error", reject)
        socket.setTimeout(2_000, () => {
          socket.destroy()
          reject(new Error("timeout"))
        })
      })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
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
  console.log(`\n[app:dev] Pre-compiling ${url} (WSL 首启可能要数分钟，请稍候)…\n`)
  const status = await request(url)
  if (status < 200 || status >= 500) throw new Error(`Warmup got HTTP ${status}`)
  console.log(`\n[app:dev] Frontend ready (${((Date.now() - start) / 1_000).toFixed(1)}s).\n`)
}

function tauriCliPath(cwd) {
  return path.join(cwd, "node_modules", "@tauri-apps", "cli", "tauri.js")
}

function showTauriVersion(cwd) {
  const result = spawnSync(process.execPath, [tauriCliPath(cwd), "--version"], { stdio: "inherit" })
  if (result.error) throw result.error
  return result.status ?? 1
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const parsedArgs = parseAppDevArgs(argv)
  if (parsedArgs.help) {
    console.log(APP_DEV_HELP.trimEnd())
    return 0
  }
  if (parsedArgs.version) return showTauriVersion(cwd)

  // 从这里开始才允许探测环境、占用端口或启动子进程。
  const devUrl = parseDevUrl(parsedArgs.userArgs)
  const env = createAppEnvironment()
  const homeUrl = `${devUrl}/`
  const port = Number(new URL(devUrl).port || 80)
  let nextChild = null
  let tauriChild = null
  let stopPromise = null

  const stopOwnedChildren = () => {
    if (stopPromise) return stopPromise
    stopPromise = (async () => {
      const tauri = tauriChild
      const next = nextChild
      tauriChild = null
      nextChild = null
      await Promise.all([
        stopChildProcess(tauri, { cleanupExitedGroup: true }),
        stopChildProcess(next, { cleanupExitedGroup: true }),
      ])
    })()
    return stopPromise
  }
  const removeShutdownHandlers = installShutdownHandlers(stopOwnedChildren)

  try {
    if (!(await portTaken(port))) {
      const nextBin = path.join(cwd, "node_modules", "next", "dist", "bin", "next")
      nextChild = spawnDetached(process.execPath, [nextBin, "dev", "-p", String(port)], {
        cwd,
        env,
      })
      await waitForTcp(port, nextChild)
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
    if (warm) {
      // 自启 Next 允许长预热；复用外来端口时若无响应应快速失败，避免假 Next 卡死 15 分钟。
      if (!nextChild) {
        try {
          const status = await request(homeUrl, { method: "GET", timeoutMs: 20_000 })
          if (status < 200 || status >= 500) {
            throw new Error(`Warmup got HTTP ${status}`)
          }
          console.log(`[app:dev] Frontend ready (reused). Launching Tauri…`)
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          throw new Error(
            `端口 ${port} 已被占用，但 ${homeUrl} 无可用响应 (${detail})。\n` +
              `当前监听方不是 Next 开发服。请释放该端口，或换端口启动：\n` +
              `  pnpm app:dev --config "{\\"build\\":{\\"devUrl\\":\\"http://localhost:5021\\"}}"`,
          )
        }
      } else {
        await warmupHome(homeUrl)
      }
    } else console.log("[app:dev] Frontend already warm. Launching Tauri…")

    // Next dev 依赖 eval + HMR WebSocket；仅开发 wrapper 放宽 CSP，生产仍使用 tauri.conf.json。
    const devCsp =
      "default-src 'self' tauri:; script-src 'self' tauri: 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; font-src 'self' data:; connect-src 'self' tauri: ws: wss: http://127.0.0.1:* http://localhost:*; frame-src 'self' tauri: https://www.wonita.link https://wonita.link https://stately.ai; worker-src 'self' blob:"
    const wrapperConfig = JSON.stringify({
      build: { beforeDevCommand: "", devUrl },
      app: { security: { csp: devCsp } },
    })
    const delimiterIndex = parsedArgs.userArgs.indexOf("--")
    const tauriOptions =
      delimiterIndex < 0 ? parsedArgs.userArgs : parsedArgs.userArgs.slice(0, delimiterIndex)
    const runnerArgs = delimiterIndex < 0 ? [] : parsedArgs.userArgs.slice(delimiterIndex)
    tauriChild = spawnDetached(
      process.execPath,
      [
        tauriCliPath(cwd),
        "dev",
        "--no-dev-server-wait",
        ...tauriOptions,
        "--config",
        wrapperConfig,
        ...runnerArgs,
      ],
      { cwd, env },
    )

    const tauriExit = waitForChildExit(tauriChild).then((outcome) => ({ source: "tauri", outcome }))
    const firstExit = nextChild
      ? await Promise.race([
          tauriExit,
          waitForChildExit(nextChild).then((outcome) => ({ source: "next", outcome })),
        ])
      : await tauriExit
    if (firstExit.outcome.error) throw firstExit.outcome.error
    if (firstExit.source === "next") {
      throw new Error(
        `Next.js 在 Tauri 运行期间退出 (${firstExit.outcome.signal ?? firstExit.outcome.code})`,
      )
    }
    if (firstExit.outcome.signal) return 1
    return firstExit.outcome.code ?? 1
  } finally {
    await stopOwnedChildren()
    removeShutdownHandlers()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch((error) => {
      console.error(`[app:dev] ${error instanceof Error ? error.message : error}`)
      process.exitCode = 1
    })
}
