import { spawn } from "node:child_process"
import { createServer } from "node:net"

const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const PORTS = [5020, 5021, 5022, 5023]
const READY_TIMEOUT_MS = 90_000
const SHUTDOWN_TIMEOUT_MS = 5_000

let devServer = null

function runCommand(args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(PNPM, args, {
      env,
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${PNPM} ${args.join(" ")} exited with ${signal ?? code}`))
    })
  })
}

function startDevServer(port) {
  const child = spawn(PNPM, ["exec", "next", "dev", "-p", String(port)], {
    detached: process.platform !== "win32",
    env: process.env,
    stdio: "inherit",
  })
  child.on("exit", (code, signal) => {
    if (devServer === child) {
      console.log(`\n[verify:full] dev server exited: ${signal ?? code}`)
    }
  })
  return child
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port)
  })
}

async function waitForServer(baseUrl, child) {
  const end = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < end) {
    if (child.exitCode != null || child.signalCode != null) {
      return false
    }
    try {
      const response = await fetch(`${baseUrl}/home`, { signal: AbortSignal.timeout(2_000) })
      if (response.status < 500) return true
    } catch {
      // Retry until Next finishes booting or the port is unavailable.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`dev server did not become ready at ${baseUrl}`)
}

async function stopDevServer() {
  const child = devServer
  if (!child || child.exitCode != null || child.signalCode != null) return
  devServer = null

  await new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        if (process.platform === "win32") child.kill("SIGKILL")
        else process.kill(-child.pid, "SIGKILL")
      } catch {
        // Already exited.
      }
    }, SHUTDOWN_TIMEOUT_MS)

    child.once("exit", () => {
      clearTimeout(killTimer)
      resolve()
    })

    try {
      if (process.platform === "win32") child.kill("SIGTERM")
      else process.kill(-child.pid, "SIGTERM")
    } catch {
      clearTimeout(killTimer)
      resolve()
    }
  })
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
  const smokeScripts = ["smoke:notes", "smoke:files", "smoke:plugins", "smoke:trash"]

  console.log("[verify:full] running base verification")
  await runCommand(["verify"])

  const baseUrl = await startReadyDevServer()
  const env = { ...process.env, BASE: baseUrl }

  try {
    for (const script of smokeScripts) {
      console.log(`\n[verify:full] running ${script} against ${baseUrl}`)
      await runCommand([script], { env })
    }
  } finally {
    await stopDevServer()
  }
}

process.on("SIGINT", async () => {
  await stopDevServer()
  process.exit(130)
})

process.on("SIGTERM", async () => {
  await stopDevServer()
  process.exit(143)
})

main().catch(async (error) => {
  await stopDevServer()
  console.error(`\n[verify:full] ${error.message}`)
  process.exit(1)
})
