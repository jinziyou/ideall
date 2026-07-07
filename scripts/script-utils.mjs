import { spawn } from "node:child_process"
import { createServer } from "node:net"

export const NODE = process.execPath
export const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
export const IS_WIN = process.platform === "win32"

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function runCommand(command, args, { env = process.env, cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
    })
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

export function runPnpm(args, options) {
  return runCommand(PNPM, args, options)
}

export function spawnDetached(command, args, { env = process.env, cwd = process.cwd() } = {}) {
  return spawn(command, args, {
    cwd,
    detached: !IS_WIN,
    env,
    stdio: "inherit",
  })
}

export function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => server.close(() => resolve(true)))
    server.listen(port)
  })
}

export async function waitForHttpReady({
  url,
  child,
  timeoutMs,
  requestTimeoutMs = 2_000,
  intervalMs = 1_000,
  isReady = (response) => response.status < 500,
  timeoutMessage = `server did not become ready at ${url}`,
}) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (child.exitCode != null || child.signalCode != null) return false
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) })
      if (isReady(response)) return true
    } catch {
      // Keep polling until the server finishes booting or the child exits.
    }
    await sleep(intervalMs)
  }
  throw new Error(timeoutMessage)
}

export async function stopChildProcess(child, { timeoutMs = 5_000 } = {}) {
  if (!child || child.exitCode != null || child.signalCode != null) return

  await new Promise((resolve) => {
    let settled = false
    let killTimer = null
    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      resolve()
    }
    const kill = (signal) => {
      if (IS_WIN || !child.pid) child.kill(signal)
      else process.kill(-child.pid, signal)
    }
    killTimer = setTimeout(() => {
      try {
        kill("SIGKILL")
      } catch {
        done()
      }
    }, timeoutMs)

    child.once("exit", done)
    if (child.exitCode != null || child.signalCode != null) {
      done()
      return
    }

    try {
      kill("SIGTERM")
    } catch {
      done()
    }
  })
}

export function installShutdownHandlers(stop) {
  process.on("SIGINT", async () => {
    try {
      await stop()
    } finally {
      process.exit(130)
    }
  })

  process.on("SIGTERM", async () => {
    try {
      await stop()
    } finally {
      process.exit(143)
    }
  })
}
