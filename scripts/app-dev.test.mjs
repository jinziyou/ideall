import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, test } from "node:test"
import { parseAppDevArgs } from "./app-dev.mjs"
import { sleep, spawnCaptured, stopChildProcess, waitForChildExit } from "./lib/process.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const APP_DEV = path.join(ROOT, "scripts", "app-dev.mjs")
const tempRoots = []
const wrappers = []
const fixturePids = new Set()

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(
    wrappers
      .splice(0)
      .map((child) =>
        stopChildProcess(child, { timeoutMs: 250, killTimeoutMs: 500, cleanupExitedGroup: true }),
      ),
  )
  for (const pid of fixturePids) {
    if (!pidAlive(pid)) continue
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // 已退出。
    }
  }
  fixturePids.clear()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForFile(file, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(file) && Date.now() < deadline) await sleep(25)
  if (!existsSync(file)) throw new Error(`timed out waiting for ${file}`)
  const pid = Number(await readFile(file, "utf8"))
  fixturePids.add(pid)
  return pid
}

async function waitForExit(child, timeoutMs = 10_000) {
  let timer
  try {
    return await Promise.race([
      waitForChildExit(child),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out waiting for app-dev exit")), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function createFakeProject() {
  const root = await mkdtemp(path.join(tmpdir(), "ideall-app-dev-test-"))
  tempRoots.push(root)
  const nextDir = path.join(root, "node_modules", "next", "dist", "bin")
  const tauriDir = path.join(root, "node_modules", "@tauri-apps", "cli")
  await Promise.all([mkdir(nextDir, { recursive: true }), mkdir(tauriDir, { recursive: true })])

  await writeFile(
    path.join(nextDir, "next"),
    `const { writeFileSync } = require("node:fs")
const http = require("node:http")
const args = process.argv.slice(2)
const port = Number(args[args.indexOf("-p") + 1])
const server = http.createServer((_request, response) => { response.statusCode = 200; response.end("ok") })
server.listen(port, () => writeFileSync(process.env.FAKE_NEXT_PID_FILE, String(process.pid)))
process.on("SIGTERM", () => server.close(() => process.exit(0)))
`,
    "utf8",
  )
  await writeFile(
    path.join(tauriDir, "tauri.js"),
    `const { writeFileSync } = require("node:fs")
if (process.argv.includes("--version")) { console.log("tauri-cli-test"); process.exit(0) }
writeFileSync(process.env.FAKE_TAURI_PID_FILE, String(process.pid))
if (process.env.FAKE_TAURI_EXIT === "1") process.exit(0)
process.on("SIGTERM", () => process.exit(0))
setInterval(() => {}, 1000)
`,
    "utf8",
  )
  return root
}

function startAppDev(root, args, env) {
  const child = spawnCaptured(process.execPath, [APP_DEV, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
  })
  wrappers.push(child)
  return child
}

test("app-dev validates help and unknown options before touching the project", async () => {
  const emptyRoot = await mkdtemp(path.join(tmpdir(), "ideall-app-dev-empty-"))
  tempRoots.push(emptyRoot)
  const help = spawnSync(process.execPath, [APP_DEV, "--help"], {
    cwd: emptyRoot,
    encoding: "utf8",
    timeout: 2_000,
  })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /pnpm app:dev/)

  const unknown = spawnSync(process.execPath, [APP_DEV, "--definitely-unknown"], {
    cwd: emptyRoot,
    encoding: "utf8",
    timeout: 2_000,
  })
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /未知选项/)
  assert.deepEqual(parseAppDevArgs(["--release", "--target", "x86_64-unknown-linux-gnu"]), {
    help: false,
    version: false,
    userArgs: ["--release", "--target", "x86_64-unknown-linux-gnu"],
  })
})

test(
  "app-dev SIGTERM releases the Next and Tauri processes it started",
  {
    skip:
      process.platform === "win32"
        ? "Windows child.kill does not deliver a catchable SIGTERM"
        : false,
  },
  async () => {
    const root = await createFakeProject()
    const port = await freePort()
    const nextPidFile = path.join(root, "next.pid")
    const tauriPidFile = path.join(root, "tauri.pid")
    const wrapper = startAppDev(
      root,
      ["--config", JSON.stringify({ build: { devUrl: `http://localhost:${port}` } })],
      { FAKE_NEXT_PID_FILE: nextPidFile, FAKE_TAURI_PID_FILE: tauriPidFile },
    )
    const nextPid = await waitForFile(nextPidFile)
    const tauriPid = await waitForFile(tauriPidFile)
    assert.equal(wrapper.kill("SIGTERM"), true)
    const outcome = await waitForExit(wrapper)
    assert.equal(outcome.code, 143)

    for (let attempt = 0; attempt < 80 && (pidAlive(nextPid) || pidAlive(tauriPid)); attempt++) {
      await sleep(25)
    }
    assert.equal(pidAlive(nextPid), false)
    assert.equal(pidAlive(tauriPid), false)

    const probe = net.createServer()
    await new Promise((resolve, reject) => {
      probe.once("error", reject)
      probe.listen(port, resolve)
    })
    await new Promise((resolve) => probe.close(resolve))
  },
)

test("app-dev never terminates an externally managed Next server", async () => {
  const root = await createFakeProject()
  const port = await freePort()
  const nextPidFile = path.join(root, "next.pid")
  const tauriPidFile = path.join(root, "tauri.pid")
  const external = http.createServer((_request, response) => {
    response.statusCode = 200
    response.end("external")
  })
  await new Promise((resolve, reject) => {
    external.once("error", reject)
    external.listen(port, resolve)
  })
  try {
    const wrapper = startAppDev(
      root,
      ["--config", JSON.stringify({ build: { devUrl: `http://localhost:${port}` } })],
      {
        FAKE_NEXT_PID_FILE: nextPidFile,
        FAKE_TAURI_PID_FILE: tauriPidFile,
        FAKE_TAURI_EXIT: "1",
      },
    )
    const outcome = await waitForExit(wrapper)
    assert.equal(outcome.code, 0)
    assert.equal(existsSync(nextPidFile), false)
    assert.equal(external.listening, true)
  } finally {
    await new Promise((resolve) => external.close(resolve))
  }
})
