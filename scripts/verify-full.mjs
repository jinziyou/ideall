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
  const smokeOnly = process.argv.includes("--smoke-only")
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
