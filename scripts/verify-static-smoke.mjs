import { spawn } from "node:child_process"
import { createServer } from "node:net"

const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const NODE = process.execPath
const PORTS = [5030, 5031, 5032, 5033]
const READY_TIMEOUT_MS = 45_000
const SHUTDOWN_TIMEOUT_MS = 5_000

let staticServer = null

function runCommand(command, args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`))
    })
  })
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => server.close(() => resolve(true)))
    server.listen(port)
  })
}

function startStaticServer(port) {
  return spawn(NODE, ["scripts/serve-out.mjs"], {
    detached: process.platform !== "win32",
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit",
  })
}

async function waitForServer(baseUrl, child) {
  const end = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < end) {
    if (child.exitCode != null || child.signalCode != null) return false
    try {
      const response = await fetch(`${baseUrl}/home/notes`, {
        signal: AbortSignal.timeout(2_000),
      })
      if (response.status < 500) return true
    } catch {
      // Static server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`static server did not become ready at ${baseUrl}`)
}

async function stopStaticServer() {
  const child = staticServer
  if (!child || child.exitCode != null || child.signalCode != null) return
  staticServer = null

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

async function startReadyStaticServer() {
  for (const port of PORTS) {
    const baseUrl = `http://localhost:${port}`
    if (!(await isPortAvailable(port))) {
      console.log(`[verify:static-smoke] port ${port} is already in use; trying next port`)
      continue
    }

    console.log(`\n[verify:static-smoke] starting static server at ${baseUrl}`)
    staticServer = startStaticServer(port)
    const ready = await waitForServer(baseUrl, staticServer)
    if (ready) return baseUrl

    await stopStaticServer()
    console.log(`[verify:static-smoke] port ${port} unavailable; trying next port`)
  }
  throw new Error(`could not start a static server on ports ${PORTS.join(", ")}`)
}

async function main() {
  const args = process.argv.slice(2)
  const noBuild = args.includes("--no-build")
  const smokeLevel = (process.env.SMOKE_LEVEL || "full").toLowerCase() === "core" ? "core" : "full"
  const defaultSmokeScripts = ["smoke:notes", "smoke:plugins", "smoke:trash", "smoke:files"]
  const requestedScripts = args.filter((arg) => arg !== "--" && arg !== "--no-build")
  const smokeScripts = requestedScripts.length ? requestedScripts : defaultSmokeScripts
  const unknownScript = smokeScripts.find((script) => !defaultSmokeScripts.includes(script))
  if (unknownScript) {
    throw new Error(`unknown smoke script: ${unknownScript}`)
  }

  if (!noBuild) {
    console.log("[verify:static-smoke] running static export build")
    await runCommand(PNPM, ["build"])
  }

  const baseUrl = await startReadyStaticServer()
  const env = { ...process.env, BASE: baseUrl, SMOKE_LEVEL: smokeLevel }

  try {
    for (const script of smokeScripts) {
      console.log(
        `\n[verify:static-smoke] running ${script} against ${baseUrl} (level=${smokeLevel})`,
      )
      await runCommand(PNPM, [script], { env })
    }
  } finally {
    await stopStaticServer()
  }
}

process.on("SIGINT", async () => {
  await stopStaticServer()
  process.exit(130)
})

process.on("SIGTERM", async () => {
  await stopStaticServer()
  process.exit(143)
})

main().catch(async (error) => {
  await stopStaticServer()
  console.error(`\n[verify:static-smoke] ${error.message}`)
  process.exit(1)
})
