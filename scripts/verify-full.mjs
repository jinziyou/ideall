import {
  PNPM,
  installShutdownHandlers,
  isPortAvailable,
  runPnpm,
  spawnDetached,
  stopChildProcess,
  waitForHttpReady,
} from "./script-utils.mjs"

const PORTS = [5020, 5021, 5022, 5023]
const READY_TIMEOUT_MS = 90_000
const HELP = `用法:
  pnpm verify:full
  pnpm verify:smoke
  node scripts/verify-full.mjs [--smoke-only]

说明:
  verify:full 先运行 verify:base，再启动 Next dev server，并依次运行 notes/files/plugins/trash 冒烟。
  --smoke-only 跳过 verify:base，仅启动开发服并运行冒烟脚本。
`

let devServer = null

function startDevServer(port) {
  const child = spawnDetached(PNPM, ["exec", "next", "dev", "-p", String(port)])
  child.on("exit", (code, signal) => {
    if (devServer === child) {
      console.log(`\n[verify:full] dev server exited: ${signal ?? code}`)
    }
  })
  return child
}

async function waitForServer(baseUrl, child) {
  return waitForHttpReady({
    url: `${baseUrl}/home`,
    child,
    timeoutMs: READY_TIMEOUT_MS,
    timeoutMessage: `dev server did not become ready at ${baseUrl}`,
  })
}

async function stopDevServer() {
  const child = devServer
  devServer = null
  await stopChildProcess(child)
}

async function startReadyDevServer() {
  for (const port of PORTS) {
    const baseUrl = `http://localhost:${port}`
    if (!(await isPortAvailable(port))) {
      console.log(`[verify:full] port ${port} is already in use; trying next port`)
      continue
    }

    console.log(`\n[verify:full] starting Next dev server at ${baseUrl}`)
    devServer = startDevServer(port)
    const ready = await waitForServer(baseUrl, devServer)
    if (ready) return baseUrl

    await stopDevServer()
    console.log(`[verify:full] port ${port} unavailable; trying next port`)
  }
  throw new Error(`could not start a dev server on ports ${PORTS.join(", ")}`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP.trimEnd())
    return
  }

  const unknownArg = args.find((arg) => arg !== "--smoke-only")
  if (unknownArg) throw new Error(`unknown argument: ${unknownArg}`)

  const smokeOnly = args.includes("--smoke-only")
  const smokeScripts = ["smoke:notes", "smoke:files", "smoke:plugins", "smoke:trash"]

  if (!smokeOnly) {
    console.log("[verify:full] running base verification")
    await runPnpm(["verify:base"])
  }

  const baseUrl = await startReadyDevServer()
  const env = { ...process.env, BASE: baseUrl }

  try {
    for (const script of smokeScripts) {
      console.log(`\n[verify:full] running ${script} against ${baseUrl}`)
      await runPnpm([script], { env })
    }
  } finally {
    await stopDevServer()
  }
}

installShutdownHandlers(stopDevServer)

main().catch(async (error) => {
  await stopDevServer()
  console.error(`\n[verify:full] ${error.message}`)
  process.exit(1)
})
